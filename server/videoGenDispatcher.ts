import { appendStudioAudit } from "./studioRepository";
import {
  createVideoGenJobs,
  listActiveVideoGenAdapters,
  listAllVideoGenAdapters,
  listShotPlansByScript,
  updateShotPlanStatus,
} from "./videoGenRepository";
import type { ShotPlan, VideoGenAdapter, VideoGenJob, VideoGenMode } from "./videoGenTypes";

function costPerSecondFromConfig(adapter: VideoGenAdapter): number {
  const raw = adapter.config?.cost_per_second;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.05;
}

function estimateCost(adapter: VideoGenAdapter, durationSeconds: number): number {
  return Number((costPerSecondFromConfig(adapter) * durationSeconds).toFixed(4));
}

function chooseMode(shot: ShotPlan): VideoGenMode {
  if (shot.referenceAssetId) return "i2v";
  return "t2v";
}

/**
 * Cria video_gen_jobs a partir dos shot_plans de um script.
 * Escolhe o adapter ativo de menor priority.
 * Custo vem do config do adapter (cost_per_second * duration).
 * Duplicatas são barradas pelo unique parcial + check no repositório.
 */
export async function dispatchVideoGenJobs(params: {
  scriptId: number;
  videoId?: number | null;
  actor?: "Você" | "Nexo";
}): Promise<{
  jobs: VideoGenJob[];
  provider: string | null;
  adaptersAvailable: Array<{ provider: string; plan: string; active: boolean; priority: number }>;
  message: string;
}> {
  const { scriptId, videoId = null, actor = "Você" } = params;

  const shots = await listShotPlansByScript(scriptId);
  if (!shots.length) {
    throw new Error("Nenhum plano de cenas encontrado. Rode o Diretor de IA primeiro.");
  }

  const active = await listActiveVideoGenAdapters();
  const all = await listAllVideoGenAdapters();
  const adaptersAvailable = all.map((a) => ({
    provider: a.provider,
    plan: a.plan,
    active: a.active,
    priority: a.priority,
  }));

  if (!active.length) {
    return {
      jobs: [],
      provider: null,
      adaptersAvailable,
      message:
        "Nenhum adapter de video_gen está ativo. Ative PixVerse, Kling, Seedance ou Wan em adapters (active=true) depois de configurar as credenciais.",
    };
  }

  const chosen = active[0];
  const modeDefault = chooseMode(shots[0]);

  const jobs = await createVideoGenJobs(
    shots.map((shot) => ({
      shotPlanId: shot.id,
      videoId,
      provider: chosen.provider,
      mode: chooseMode(shot),
      prompt: shot.promptText,
      negativePrompt:
        "text, watermark, logo, blurry, low quality, distorted face, extra limbs, nsfw",
      referenceAssetId: shot.referenceAssetId,
      estimatedCost: estimateCost(chosen, shot.durationSeconds),
    })),
  );

  for (const shot of shots) {
    await updateShotPlanStatus(shot.id, "generating");
  }

  await appendStudioAudit({
    actor,
    action: "Jobs de geração de vídeo enfileirados",
    target: `script:${scriptId}`,
    details: {
      jobCount: jobs.length,
      skippedDuplicates: shots.length - jobs.length,
      provider: chosen.provider,
      mode: modeDefault,
      estimatedTotalCost: jobs.reduce((s, j) => s + j.estimatedCost, 0),
      currency: (chosen.config?.currency as string) ?? "USD",
    },
  });

  const skipped = shots.length - jobs.length;
  const skipNote = skipped > 0 ? ` (${skipped} cena(s) já tinham job ativo e foram ignoradas)` : "";

  return {
    jobs,
    provider: chosen.provider,
    adaptersAvailable,
    message: `${jobs.length} jobs enfileirados no provider ${chosen.provider}${skipNote}. O worker consome a fila.`,
  };
}
