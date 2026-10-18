import { completeWithFallback } from "./llmProviders";
import { appendStudioAudit } from "./studioRepository";
import { replaceShotPlansForScript, listShotPlansByScript } from "./videoGenRepository";
import type { ShotPlan, ShotPlanInput } from "./videoGenTypes";

const DIRECTOR_SYSTEM = `Você é o Diretor de IA do Estúdio de Canal IA.
Sua tarefa é quebrar um roteiro aprovado em cenas curtas e filmáveis para geração de vídeo por IA (text-to-video / image-to-video).

Regras obrigatórias:
- Responda APENAS com JSON válido (array), sem markdown e sem texto fora do JSON.
- Cada cena deve ter entre 4 e 15 segundos (preferência 6–10s).
- Máximo de 12 cenas por roteiro.
- Escreva prompts em inglês (melhor desempenho nos modelos atuais), mas description e cameraNotes em português.
- Prompts devem ser cinematográficos, concretos e sem texto na tela.
- Evite conteúdo violento, sexual ou de menores em situações perigosas.
- Se o roteiro mencionar personagem recorrente infantil, mantenha aparência consistente nos prompts.

Formato de cada item do array:
{
  "sceneNumber": number,
  "durationSeconds": number,
  "description": string (PT-BR, 1 frase),
  "promptText": string (EN, detalhado),
  "cameraNotes": string (PT-BR, opcional),
  "audioNotes": string (PT-BR, opcional)
}`;

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  // Remove possíveis fences
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("O Diretor de IA não retornou um array JSON válido.");
  }
  return JSON.parse(unfenced.slice(start, end + 1));
}

function normalizeScenes(raw: unknown): ShotPlanInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("O Diretor de IA retornou zero cenas.");
  }
  if (raw.length > 12) {
    throw new Error("O Diretor de IA retornou mais de 12 cenas. Reduza o roteiro.");
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Cena ${index + 1} inválida.`);
    }
    const scene = item as Record<string, unknown>;
    const sceneNumber = Number(scene.sceneNumber ?? index + 1);
    const durationSeconds = Math.min(15, Math.max(4, Number(scene.durationSeconds ?? 8)));
    const description = String(scene.description ?? "").trim();
    const promptText = String(scene.promptText ?? "").trim();
    if (!description || !promptText) {
      throw new Error(`Cena ${sceneNumber} sem description ou promptText.`);
    }
    return {
      sceneNumber,
      durationSeconds,
      description: description.slice(0, 500),
      promptText: promptText.slice(0, 2000),
      cameraNotes: scene.cameraNotes ? String(scene.cameraNotes).slice(0, 400) : undefined,
      audioNotes: scene.audioNotes ? String(scene.audioNotes).slice(0, 400) : undefined,
    } satisfies ShotPlanInput;
  });
}

/**
 * Quebra um roteiro aprovado em shot_plans via LLM.
 * Substitui apenas planos ainda em status 'planned'.
 */
export async function runVideoDirector(params: {
  scriptId: number;
  scriptContent: string;
  title?: string;
  actor?: "Você" | "Nexo";
}): Promise<{ scenes: ShotPlan[]; provider: string; model: string }> {
  const { scriptId, scriptContent, title, actor = "Você" } = params;

  if (!scriptContent || scriptContent.trim().length < 40) {
    throw new Error("Roteiro muito curto para gerar plano de cenas.");
  }

  const userPrompt = [
    title ? `Título do vídeo: ${title}` : null,
    "Roteiro aprovado (Portão 1):",
    scriptContent.slice(0, 12_000),
    "",
    "Gere o array JSON de cenas agora.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await completeWithFallback("roteiro", [
    { role: "system", content: DIRECTOR_SYSTEM },
    { role: "user", content: userPrompt },
  ]);

  const scenes = normalizeScenes(extractJsonArray(result.text));
  const saved = await replaceShotPlansForScript(scriptId, scenes);

  await appendStudioAudit({
    actor,
    action: "Plano de cenas gerado pelo Diretor de IA",
    target: `script:${scriptId}`,
    details: {
      sceneCount: saved.length,
      provider: result.provider,
      model: result.model,
      totalSeconds: saved.reduce((sum, s) => sum + s.durationSeconds, 0),
    },
  });

  return { scenes: saved, provider: result.provider, model: result.model };
}

export async function getShotPlans(scriptId: number) {
  return listShotPlansByScript(scriptId);
}
