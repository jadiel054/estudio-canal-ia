import { appendStudioAudit } from "./studioRepository";
import {
  createVideoGenJobs,
  listActiveVideoGenAdapters,
  listAllVideoGenAdapters,
  listShotPlansByScript,
  updateShotPlanStatus,
} from "./videoGenRepository";
import type { ShotPlan, VideoGenJob, VideoGenMode } from "./videoGenTypes";

/**
 * Estimativa grosseira de custo em USD por segundo de vídeo.
 * Valores conservadores para planejamento; o custo real vem do callback do provider.
 */
const COST_PER_SECOND: Record<string, number> = {
  wan_selfhosted: 0.01,
  seedance_api: 0.08,
  pixverse_api: 0.04,
  kling_api: 0.06,
  fal_ai: 0.05,
};

function estimateCost(provider: string, durationSeconds: number): number {
  const rate = COST_PER_SECOND[provider] ?? 0.05;
  return Number((rate * durationSeconds).toFixed(4));
}

function chooseMode(shot: ShotPlan): VideoGenMode {
  // Preferir i2v quando há referência de personagem/frame
  if (shot.referenceAssetId) return "i2v";
  return "t2v";
}

/**
 * Cria video_gen_jobs a partir dos shot_plans aprovados/planejados de um script.
 * Escolhe o adapter ativo de menor prioridade.
 *
 * Se nenhum adapter estiver ativo, retorna a lista de adapters disponíveis
 * (todos inativos) para o operador decidir qual ativar.
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

  const chosen = active[0]; // menor priority
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
      estimatedCost: estimateCost(chosen.provider, shot.durationSeconds),
    })),
  );

  // Marca cenas como generating
  for (const shot of shots) {
    await updateShotPlanStatus(shot.id, "generating");
  }

  await appendStudioAudit({
    actor,
    action: "Jobs de geração de vídeo enfileirados",
    target: `script:${scriptId}`,
    details: {
      jobCount: jobs.length,
      provider: chosen.provider,
      mode: modeDefault,
      estimatedTotalCost: jobs.reduce((s, j) => s + j.estimatedCost, 0),
    },
  });

  return {
    jobs,
    provider: chosen.provider,
    adaptersAvailable,
    message: `${jobs.length} jobs enfileirados no provider ${chosen.provider}. Nenhum provider externo foi chamado ainda — o worker consome a fila.`,
  };
}
