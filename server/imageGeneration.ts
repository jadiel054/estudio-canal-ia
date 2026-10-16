import {
  IMAGE_GENERATION_POLICY,
  IMAGE_PRESETS,
  imageCacheKey,
  imageGenerationBlockReason,
  imagePromptHash,
  type ImageGenerationPolicy,
  type ImagePreset,
} from "./imagePolicy";
import {
  ImageCacheIntegrityError,
  ImageStoreUnavailableError,
  PostgresImageStore,
  type ImageCacheLookup,
  type ImageFailureCode,
  type ImageRequestMetadata,
  type ImageReservation,
} from "./imageCache";
import { validateImagePayload, type ValidatedImage } from "./imageValidation";

const MAX_VISUAL_DIRECTION_CHARS = 8_000;

type ImageInput = {
  visualDirection: string;
  preset: ImagePreset;
  width: number;
  height: number;
  videoId: string;
  jobId?: string;
  sectionIndex: number;
};

export type ImageProviderRequest = {
  visualDirection: string;
  preset: ImagePreset;
  width: number;
  height: number;
  model: string;
  modelRevision: string;
};

export type ImageProviderOutput = {
  bytes: Uint8Array;
  mimeType: string;
  httpStatus?: number;
  actualCostUsd?: number;
};

/** Implementação de provider é injetada pelo adapter; esta PR não define transporte externo. */
export interface ImageProviderAdapter {
  generate(request: ImageProviderRequest): Promise<ImageProviderOutput>;
}

export type ImageGenerationResult =
  | {
      status: "cache_hit" | "generated";
      image: ValidatedImage;
      cacheKey: string;
      promptHash: string;
    }
  | {
      status:
        | "disabled"
        | "blocked"
        | "in_flight"
        | "unavailable"
        | "invalid_image"
        | "provider_failure";
      reason: string;
      cacheKey?: string;
      promptHash?: string;
    };

export interface ImageStore {
  lookupAndAudit(metadata: ImageRequestMetadata): Promise<ImageCacheLookup>;
  recordEvent(
    metadata: ImageRequestMetadata,
    eventType: "blocked" | "singleflight_wait",
    status: "blocked" | "in_flight",
    failureCode?: ImageFailureCode
  ): Promise<void>;
  isAdapterActive(policy: ImageGenerationPolicy): Promise<boolean>;
  reserve(
    metadata: ImageRequestMetadata,
    policy: ImageGenerationPolicy,
    estimatedCostUsd: number | null
  ): Promise<ImageReservation>;
  complete(
    metadata: ImageRequestMetadata,
    reservationId: string,
    image: ValidatedImage,
    options: { actualCostUsd?: number; cacheTtlDays: number }
  ): Promise<void>;
  fail(
    reservationId: string,
    failureCode: ImageFailureCode,
    options?: { httpStatus?: number; actualCostUsd?: number }
  ): Promise<void>;
}

function isValidInput(input: ImageInput): boolean {
  return (
    typeof input.visualDirection === "string" &&
    input.visualDirection.trim().length > 0 &&
    input.visualDirection.length <= MAX_VISUAL_DIRECTION_CHARS &&
    typeof input.preset === "string" &&
    Object.hasOwn(IMAGE_PRESETS, input.preset) &&
    Number.isInteger(input.width) &&
    input.width > 0 &&
    input.width <= 4_096 &&
    Number.isInteger(input.height) &&
    input.height > 0 &&
    input.height <= 4_096 &&
    input.width * input.height <= 16_777_216 &&
    typeof input.videoId === "string" &&
    input.videoId.trim().length > 0 &&
    input.videoId.length <= 200 &&
    (input.jobId === undefined ||
      (typeof input.jobId === "string" && input.jobId.length <= 200)) &&
    Number.isInteger(input.sectionIndex) &&
    input.sectionIndex >= 0 &&
    input.sectionIndex <= 79
  );
}

function safeHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("httpStatus" in error))
    return undefined;
  const status = (error as { httpStatus?: unknown }).httpStatus;
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : undefined;
}

function safeActualCost(value: number | undefined): number | undefined {
  return value !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000
    ? value
    : undefined;
}

function isImageStoreUnavailable(error: unknown): boolean {
  return error instanceof ImageStoreUnavailableError;
}

function validateStoredOrProviderImage(
  image: { bytes: Uint8Array; mimeType: string },
  input: ImageInput,
  policy: ImageGenerationPolicy
) {
  return validateImagePayload({
    bytes: image.bytes,
    declaredMimeType: image.mimeType,
    expectedWidth: input.width,
    expectedHeight: input.height,
    maxBytes: policy.maxImageBytes,
  });
}

function resultFromCache(
  lookup: { kind: "hit" | "cache_hit"; image: ValidatedImage },
  input: ImageInput,
  policy: ImageGenerationPolicy,
  metadata: ImageRequestMetadata
): ImageGenerationResult {
  const cached = lookup.image;
  const checked = validateStoredOrProviderImage(cached, input, policy);
  if (!checked.ok || checked.image.sha256 !== cached.sha256) {
    return {
      status: "invalid_image",
      reason: checked.ok ? "cache_corrupt" : checked.code,
      cacheKey: metadata.cacheKey,
      promptHash: metadata.promptHash,
    };
  }
  return {
    status: "cache_hit",
    image: checked.image,
    cacheKey: metadata.cacheKey,
    promptHash: metadata.promptHash,
  };
}

export function createImageGenerationAdapter(options: {
  store: ImageStore;
  provider?: ImageProviderAdapter;
  policy?: ImageGenerationPolicy;
  readFeatureFlag?: () => boolean;
}) {
  const policy = options.policy ?? IMAGE_GENERATION_POLICY;
  const inFlight = new Map<string, Promise<ImageGenerationResult>>();

  async function runAfterCacheMiss(
    input: ImageInput,
    metadata: ImageRequestMetadata
  ): Promise<ImageGenerationResult> {
    const recordBlocked = async (code: ImageFailureCode) => {
      try {
        await options.store.recordEvent(metadata, "blocked", "blocked", code);
      } catch {
        /* no provider call is allowed without persistence */
      }
    };
    const featureFlagEnabled =
      options.readFeatureFlag?.() ??
      process.env.STUDIO_IMAGE_GENERATION_ENABLED === "true";
    // Primeiro verificamos os gates estáticos; a ativação no banco é lida abaixo.
    const policyReason = imageGenerationBlockReason(policy, {
      featureFlagEnabled,
      adapterActive: true,
    });
    if (policyReason) {
      await recordBlocked(policyReason);
      return {
        status:
          policyReason === "feature_disabled" ||
          policyReason === "policy_disabled"
            ? "disabled"
            : "blocked",
        reason: policyReason,
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }

    if (!options.provider) {
      await recordBlocked(
        metadata ? "provider_unconfigured" : "provider_unconfigured"
      );
      return {
        status: "blocked",
        reason: "provider_unconfigured",
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }

    let adapterActive: boolean;
    try {
      adapterActive = await options.store.isAdapterActive(policy);
    } catch {
      return {
        status: "unavailable",
        reason: "storage_unavailable",
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }
    const adapterReason = imageGenerationBlockReason(policy, {
      featureFlagEnabled,
      adapterActive,
    });
    if (adapterReason) {
      await recordBlocked(adapterReason);
      return {
        status: "blocked",
        reason: adapterReason,
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }

    const reservation = await options.store.reserve(
      metadata,
      policy,
      policy.unitCostUsd
    );
    if (reservation.kind === "blocked") {
      return {
        status: "blocked",
        reason: reservation.code,
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }
    if (reservation.kind === "in_flight") {
      return {
        status: "in_flight",
        reason: "singleflight_active",
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }
    if (reservation.kind === "cache_hit")
      return resultFromCache(reservation, input, policy, metadata);

    let providerOutput: ImageProviderOutput;
    try {
      // A reserva foi confirmada em transação antes de qualquer operação do provider.
      providerOutput = await options.provider.generate({
        visualDirection: input.visualDirection.normalize("NFC").trim(),
        preset: input.preset,
        width: input.width,
        height: input.height,
        model: policy.model,
        modelRevision: policy.modelRevision,
      });
    } catch (error) {
      try {
        await options.store.fail(reservation.id, "provider_failure", {
          httpStatus: safeHttpStatus(error),
        });
      } catch {
        /* não incluir erro bruto em log */
      }
      return {
        status: "provider_failure",
        reason: "provider_failure",
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }

    const checked = validateStoredOrProviderImage(
      providerOutput,
      input,
      policy
    );
    if (!checked.ok) {
      try {
        await options.store.fail(reservation.id, checked.code, {
          httpStatus: safeHttpStatus(providerOutput),
          actualCostUsd: safeActualCost(providerOutput.actualCostUsd),
        });
      } catch {
        /* não registrar bytes nem texto de provider */
      }
      return {
        status: "invalid_image",
        reason: checked.code,
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }

    const actualCostUsd = safeActualCost(providerOutput.actualCostUsd);
    if (
      actualCostUsd !== undefined &&
      actualCostUsd > (policy.unitCostUsd ?? 0) + 1e-9
    ) {
      try {
        await options.store.fail(reservation.id, "budget_exceeded", {
          actualCostUsd,
        });
      } catch {
        /* custo não vira log de conteúdo */
      }
      return {
        status: "blocked",
        reason: "budget_exceeded",
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }

    try {
      await options.store.complete(metadata, reservation.id, checked.image, {
        actualCostUsd,
        cacheTtlDays: policy.cacheTtlDays,
      });
    } catch (error) {
      if (error instanceof ImageCacheIntegrityError) {
        try {
          await options.store.fail(reservation.id, "invalid_image_bytes");
        } catch {
          /* manter resposta sanitizada */
        }
        return {
          status: "invalid_image",
          reason: "invalid_image_bytes",
          cacheKey: metadata.cacheKey,
          promptHash: metadata.promptHash,
        };
      }
      try {
        await options.store.fail(reservation.id, "storage_unavailable");
      } catch {
        /* reserva expira se a persistência estiver indisponível */
      }
      return {
        status: "unavailable",
        reason: "storage_unavailable",
        cacheKey: metadata.cacheKey,
        promptHash: metadata.promptHash,
      };
    }
    return {
      status: "generated",
      image: checked.image,
      cacheKey: metadata.cacheKey,
      promptHash: metadata.promptHash,
    };
  }

  return {
    async generate(input: ImageInput): Promise<ImageGenerationResult> {
      if (!isValidInput(input))
        return { status: "blocked", reason: "invalid_request" };
      const presetVersion = IMAGE_PRESETS[input.preset].version;
      const visualDirection = input.visualDirection.normalize("NFC").trim();
      const metadata: ImageRequestMetadata = {
        cacheKey: imageCacheKey(
          {
            visualDirection,
            preset: input.preset,
            width: input.width,
            height: input.height,
          },
          policy
        ),
        promptHash: imagePromptHash(visualDirection),
        policyVersion: policy.policyVersion,
        provider: policy.provider,
        model: policy.model,
        modelRevision: policy.modelRevision,
        preset: input.preset,
        presetVersion,
        width: input.width,
        height: input.height,
        videoId: input.videoId,
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        sectionIndex: input.sectionIndex,
      };

      let lookup: ImageCacheLookup;
      try {
        lookup = await options.store.lookupAndAudit(metadata);
      } catch (error) {
        return {
          status: "unavailable",
          reason: isImageStoreUnavailable(error)
            ? "storage_unavailable"
            : "storage_unavailable",
          cacheKey: metadata.cacheKey,
          promptHash: metadata.promptHash,
        };
      }
      if (lookup.kind === "hit")
        return resultFromCache(lookup, input, policy, metadata);

      const existing = inFlight.get(metadata.cacheKey);
      if (existing) {
        try {
          await options.store.recordEvent(
            metadata,
            "singleflight_wait",
            "in_flight"
          );
        } catch {
          return {
            status: "unavailable",
            reason: "storage_unavailable",
            cacheKey: metadata.cacheKey,
            promptHash: metadata.promptHash,
          };
        }
        return existing;
      }

      const task = runAfterCacheMiss(input, metadata);
      inFlight.set(metadata.cacheKey, task);
      try {
        return await task;
      } catch {
        return {
          status: "unavailable",
          reason: "storage_unavailable",
          cacheKey: metadata.cacheKey,
          promptHash: metadata.promptHash,
        };
      } finally {
        if (inFlight.get(metadata.cacheKey) === task)
          inFlight.delete(metadata.cacheKey);
      }
    },
  };
}

/** Instância de servidor: sem provider configurado, política inativa e sem transporte externo. */
export const imageGenerationAdapter = createImageGenerationAdapter({
  store: new PostgresImageStore(),
});
