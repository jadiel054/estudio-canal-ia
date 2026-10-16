import { createHash } from "node:crypto";

export const IMAGE_PRESETS = {
  "tutorial-visual-v1": { version: "1" },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

/**
 * Política de candidato, não uma autorização de uso. O alias do modelo no
 * provider não oferece pinagem imutável conhecida nesta etapa; por isso os
 * bloqueios abaixo são deliberados e precisam de uma revisão de código antes
 * de qualquer geração real.
 */
export type ImageGenerationPolicy = Readonly<{
  policyVersion: string;
  provider: string;
  model: string;
  modelRevision: string;
  preset: ImagePreset;
  presetVersion: string;
  generationAllowed: boolean;
  licenseApproved: boolean;
  termsApproved: boolean;
  modelRevisionPinned: boolean;
  unitCostUsd: number | null;
  maxImagesPerVideo: number;
  hardMaxImagesPerVideo: number;
  maxAttemptsPerCacheKey: number;
  maxBudgetUsdPerVideo: number;
  cacheTtlDays: number;
  maxImageBytes: number;
}>;

export const IMAGE_GENERATION_POLICY: ImageGenerationPolicy = Object.freeze({
  policyVersion: "studio-image-policy-v1",
  provider: "cloudflare_workers_ai",
  model: "@cf/black-forest-labs/flux-2-klein-4b",
  // Identificador interno fixo; NÃO afirma que o alias remoto esteja pinado.
  modelRevision: "provider-alias-unpinned-v1",
  preset: "tutorial-visual-v1",
  presetVersion: "1",
  generationAllowed: false,
  licenseApproved: false,
  termsApproved: false,
  modelRevisionPinned: false,
  // O preço/quota efetivos ainda precisam ser confirmados; falhar fechado.
  unitCostUsd: null,
  maxImagesPerVideo: 8,
  hardMaxImagesPerVideo: 12,
  maxAttemptsPerCacheKey: 2,
  maxBudgetUsdPerVideo: 0.5,
  cacheTtlDays: 7,
  maxImageBytes: 8 * 1024 * 1024,
});

export type ImagePolicyBlockReason =
  | "feature_disabled"
  | "policy_disabled"
  | "license_unconfirmed"
  | "terms_unconfirmed"
  | "model_revision_unpinned"
  | "cost_unknown"
  | "adapter_inactive";

export function imageGenerationBlockReason(
  policy: ImageGenerationPolicy,
  state: { featureFlagEnabled: boolean; adapterActive: boolean }
): ImagePolicyBlockReason | undefined {
  if (!state.featureFlagEnabled) return "feature_disabled";
  if (!policy.generationAllowed) return "policy_disabled";
  if (!policy.licenseApproved) return "license_unconfirmed";
  if (!policy.termsApproved) return "terms_unconfirmed";
  if (!policy.modelRevisionPinned) return "model_revision_unpinned";
  if (
    policy.unitCostUsd === null ||
    !Number.isFinite(policy.unitCostUsd) ||
    policy.unitCostUsd <= 0
  )
    return "cost_unknown";
  if (!state.adapterActive) return "adapter_inactive";
  return undefined;
}

function normalizedVisualDirection(value: string): string {
  return value.normalize("NFC").trim();
}

export function imagePromptHash(visualDirection: string): string {
  return createHash("sha256")
    .update(normalizedVisualDirection(visualDirection), "utf8")
    .digest("hex");
}

/** A chave contém o hash do texto, nunca o texto editorial em si. */
export function imageCacheKey(
  input: {
    visualDirection: string;
    preset: ImagePreset;
    width: number;
    height: number;
  },
  policy: ImageGenerationPolicy = IMAGE_GENERATION_POLICY
): string {
  const presetVersion = IMAGE_PRESETS[input.preset].version;
  const stable = JSON.stringify([
    "studio-image-cache-v1",
    policy.policyVersion,
    policy.provider,
    policy.model,
    policy.modelRevision,
    input.preset,
    presetVersion,
    input.width,
    input.height,
    normalizedVisualDirection(input.visualDirection),
  ]);
  return createHash("sha256").update(stable, "utf8").digest("hex");
}
