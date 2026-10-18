/** Tipos da Etapa D — Motor de Geração de Vídeo. */

export type ShotPlanStatus = "planned" | "approved" | "generating" | "done" | "failed";
export type VideoGenJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type VideoGenMode = "t2v" | "i2v" | "ti2v" | "ref2video";
export type VideoGenProvider =
  | "wan_selfhosted"
  | "seedance_api"
  | "pixverse_api"
  | "kling_api"
  | "fal_ai";

export type ShotPlan = {
  id: number;
  scriptId: number;
  sceneNumber: number;
  durationSeconds: number;
  description: string;
  promptText: string;
  cameraNotes: string | null;
  audioNotes: string | null;
  referenceAssetId: number | null;
  status: ShotPlanStatus;
  createdAt: string;
};

export type VideoGenJob = {
  id: number;
  shotPlanId: number;
  videoId: number | null;
  provider: string;
  mode: VideoGenMode;
  prompt: string;
  negativePrompt: string | null;
  referenceAssetId: number | null;
  status: VideoGenJobStatus;
  attempts: number;
  maxAttempts: number;
  providerJobId: string | null;
  outputAssetId: number | null;
  estimatedCost: number;
  actualCost: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type ShotPlanInput = {
  sceneNumber: number;
  durationSeconds: number;
  description: string;
  promptText: string;
  cameraNotes?: string;
  audioNotes?: string;
  referenceAssetId?: number | null;
};

export type VideoGenAdapter = {
  id: number;
  capability: string;
  provider: string;
  plan: string;
  active: boolean;
  priority: number;
  config: Record<string, unknown>;
};
