import { describe, expect, it, vi } from "vitest";
import {
  IMAGE_GENERATION_POLICY,
  type ImageGenerationPolicy,
} from "./imagePolicy";
import {
  createImageGenerationAdapter,
  type ImageProviderAdapter,
  type ImageStore,
} from "./imageGeneration";
import type { ImageRequestMetadata } from "./imageCache";
import { validateImagePayload } from "./imageValidation";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const input = {
  visualDirection: "Diagrama abstrato, sem texto e sem marcas",
  preset: "tutorial-visual-v1" as const,
  width: 320,
  height: 180,
  videoId: "video-test-1",
  jobId: "job-test-1",
  sectionIndex: 0,
};

function enabledPolicy(): ImageGenerationPolicy {
  return {
    ...IMAGE_GENERATION_POLICY,
    generationAllowed: true,
    licenseApproved: true,
    termsApproved: true,
    modelRevisionPinned: true,
    unitCostUsd: 0.05,
  };
}

function makeStore(
  overrides: Partial<ImageStore> = {},
  order: string[] = []
): ImageStore {
  return {
    lookupAndAudit: vi.fn(async () => ({ kind: "miss" as const })),
    recordEvent: vi.fn(async () => undefined),
    isAdapterActive: vi.fn(async () => true),
    reserve: vi.fn(async () => {
      order.push("reserve");
      return { kind: "reserved" as const, id: "reservation-test" };
    }),
    complete: vi.fn(async () => {
      order.push("complete");
    }),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

function validatedPng() {
  const checked = validateImagePayload({
    bytes: png(320, 180),
    declaredMimeType: "image/png",
    expectedWidth: 320,
    expectedHeight: 180,
    maxBytes: 8 * 1024 * 1024,
  });
  if (!checked.ok) throw new Error("fixture PNG inválido");
  return checked.image;
}

function provider(
  order: string[] = [],
  generate = vi.fn(async () => ({
    bytes: png(320, 180),
    mimeType: "image/png",
    httpStatus: 200,
    actualCostUsd: 0.05,
  }))
): ImageProviderAdapter {
  return {
    generate: vi.fn(async request => {
      order.push("provider");
      return generate(request);
    }),
  };
}

describe("adapter de imagens", () => {
  it("mantém o provider sem chamadas quando a feature flag está desligada", async () => {
    const store = makeStore();
    const providerAdapter = provider();
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      readFeatureFlag: () => false,
    });

    const result = await adapter.generate(input);

    expect(result).toMatchObject({
      status: "disabled",
      reason: "feature_disabled",
    });
    expect(providerAdapter.generate).not.toHaveBeenCalled();
    expect(store.isAdapterActive).not.toHaveBeenCalled();
    expect(store.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      "blocked",
      "blocked",
      "feature_disabled"
    );
    const metadata = (store.lookupAndAudit as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as ImageRequestMetadata;
    expect(metadata).not.toHaveProperty("visualDirection");
    expect(JSON.stringify(metadata)).not.toContain(input.visualDirection);
  });

  it("não habilita geração apenas por ligar a flag: a política de código também bloqueia", async () => {
    const store = makeStore();
    const providerAdapter = provider();
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      readFeatureFlag: () => true,
    });

    await expect(adapter.generate(input)).resolves.toMatchObject({
      status: "disabled",
      reason: "policy_disabled",
    });
    expect(providerAdapter.generate).not.toHaveBeenCalled();
    expect(store.isAdapterActive).not.toHaveBeenCalled();
  });

  it("retorna cache validado sem consultar o provider", async () => {
    const image = validatedPng();
    const store = makeStore({
      lookupAndAudit: vi.fn(async () => ({ kind: "hit" as const, image })),
    });
    const providerAdapter = provider();
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      readFeatureFlag: () => false,
    });

    const result = await adapter.generate(input);

    expect(result.status).toBe("cache_hit");
    expect(providerAdapter.generate).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
  });

  it("confirma a reserva antes da chamada ao provider e só depois persiste o resultado validado", async () => {
    const order: string[] = [];
    const store = makeStore({}, order);
    const providerAdapter = provider(order);
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      policy: enabledPolicy(),
      readFeatureFlag: () => true,
    });

    const result = await adapter.generate(input);

    expect(result.status).toBe("generated");
    expect(order).toEqual(["reserve", "provider", "complete"]);
    expect(store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: input.videoId }),
      expect.objectContaining({ unitCostUsd: 0.05 }),
      0.05
    );
    expect(providerAdapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        visualDirection: input.visualDirection,
        model: IMAGE_GENERATION_POLICY.model,
        modelRevision: IMAGE_GENERATION_POLICY.modelRevision,
      })
    );
  });

  it("não chama o provider quando outra execução já reservou a cache key", async () => {
    const store = makeStore({
      reserve: vi.fn(async () => ({ kind: "in_flight" as const })),
    });
    const providerAdapter = provider();
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      policy: enabledPolicy(),
      readFeatureFlag: () => true,
    });

    await expect(adapter.generate(input)).resolves.toMatchObject({
      status: "in_flight",
    });
    expect(providerAdapter.generate).not.toHaveBeenCalled();
  });

  it("deduplica chamadas concorrentes locais em single-flight", async () => {
    let release!: (value: {
      bytes: Buffer;
      mimeType: string;
      actualCostUsd: number;
    }) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => {
      started = resolve;
    });
    const response = new Promise<{
      bytes: Buffer;
      mimeType: string;
      actualCostUsd: number;
    }>(resolve => {
      release = resolve;
    });
    const providerAdapter: ImageProviderAdapter = {
      generate: vi.fn(async () => {
        started();
        return response;
      }),
    };
    const store = makeStore();
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      policy: enabledPolicy(),
      readFeatureFlag: () => true,
    });

    const first = adapter.generate(input);
    await startedPromise;
    const second = adapter.generate(input);
    await Promise.resolve();
    expect(providerAdapter.generate).toHaveBeenCalledTimes(1);
    release({
      bytes: png(320, 180),
      mimeType: "image/png",
      actualCostUsd: 0.05,
    });
    const results = await Promise.all([first, second]);
    expect(results.map(result => result.status)).toEqual([
      "generated",
      "generated",
    ]);
    expect(store.reserve).toHaveBeenCalledTimes(1);
    expect(store.recordEvent).toHaveBeenCalledWith(
      expect.any(Object),
      "singleflight_wait",
      "in_flight"
    );
  });

  it("rejeita saída do provider com MIME/dimensões incorretos e não persiste", async () => {
    const store = makeStore();
    const providerAdapter = provider(
      [],
      vi.fn(async () => ({
        bytes: png(320, 180),
        mimeType: "image/jpeg",
        actualCostUsd: 0.05,
      }))
    );
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      policy: enabledPolicy(),
      readFeatureFlag: () => true,
    });

    await expect(adapter.generate(input)).resolves.toMatchObject({
      status: "invalid_image",
      reason: "mime_mismatch",
    });
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(
      "reservation-test",
      "mime_mismatch",
      expect.objectContaining({ actualCostUsd: 0.05 })
    );
  });

  it("falha fechado quando o cache/ledger não está disponível", async () => {
    const store = makeStore({
      lookupAndAudit: vi.fn(async () => {
        throw new Error("detalhe interno");
      }),
    });
    const providerAdapter = provider();
    const adapter = createImageGenerationAdapter({
      store,
      provider: providerAdapter,
      policy: enabledPolicy(),
      readFeatureFlag: () => true,
    });

    await expect(adapter.generate(input)).resolves.toMatchObject({
      status: "unavailable",
      reason: "storage_unavailable",
    });
    expect(providerAdapter.generate).not.toHaveBeenCalled();
  });
});
