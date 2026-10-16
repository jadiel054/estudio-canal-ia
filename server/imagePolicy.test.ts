import { describe, expect, it } from "vitest";
import {
  IMAGE_GENERATION_POLICY,
  imageCacheKey,
  imageGenerationBlockReason,
  imagePromptHash,
} from "./imagePolicy";

const input = {
  visualDirection: "Diagrama abstrato de fluxo",
  preset: "tutorial-visual-v1" as const,
  width: 1024,
  height: 576,
};

describe("política de geração visual", () => {
  it("fixa candidato/modelo/revisão no código e permanece bloqueada por padrão", () => {
    expect(IMAGE_GENERATION_POLICY).toMatchObject({
      policyVersion: "studio-image-policy-v1",
      provider: "cloudflare_workers_ai",
      model: "@cf/black-forest-labs/flux-2-klein-4b",
      modelRevision: "provider-alias-unpinned-v1",
      generationAllowed: false,
      licenseApproved: false,
      termsApproved: false,
      modelRevisionPinned: false,
      unitCostUsd: null,
    });
    expect(
      imageGenerationBlockReason(IMAGE_GENERATION_POLICY, {
        featureFlagEnabled: false,
        adapterActive: false,
      })
    ).toBe("feature_disabled");
    expect(
      imageGenerationBlockReason(IMAGE_GENERATION_POLICY, {
        featureFlagEnabled: true,
        adapterActive: true,
      })
    ).toBe("policy_disabled");
  });

  it("deriva hash e cache key sem expor a direção visual", () => {
    const key = imageCacheKey(input);
    const promptHash = imagePromptHash(input.visualDirection);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain(input.visualDirection);
    expect(promptHash).not.toContain(input.visualDirection);
    expect(
      imageCacheKey({
        ...input,
        visualDirection: `  ${input.visualDirection}  `,
      })
    ).toBe(key);
  });

  it("separa cache por texto, preset, dimensões e revisão de política", () => {
    const baseline = imageCacheKey(input);
    expect(
      imageCacheKey({ ...input, visualDirection: "Outro diagrama" })
    ).not.toBe(baseline);
    expect(imageCacheKey({ ...input, width: 1280 })).not.toBe(baseline);
    expect(imageCacheKey({ ...input, height: 720 })).not.toBe(baseline);
    expect(
      imageCacheKey(
        { ...input },
        { ...IMAGE_GENERATION_POLICY, policyVersion: "studio-image-policy-v2" }
      )
    ).not.toBe(baseline);
  });
});
