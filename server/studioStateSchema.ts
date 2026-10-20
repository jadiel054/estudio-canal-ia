import { z } from "zod";
import { MAX_SCRIPT_LINT_DIAGNOSTICS } from "./renderManifest";

/**
 * Validação do estado do estúdio recebido do cliente.
 *
 * `studio.saveState` e `studio.importState` aceitavam `z.unknown()`, o que
 * permitia gravar qualquer JSON no Neon. Aqui o formato é validado, o tamanho é
 * limitado e a versão é controlada pelo servidor.
 */
export const MAX_STATE_BYTES = 512 * 1024;

const STAGES = [
  "ideia", "pesquisa", "roteiro", "aguarda_aprov_roteiro", "assets",
  "render", "qa", "aguarda_aprov_video", "aprovado_para_agenda",
  "agendado", "publicado", "ajuste_pedido", "rejeitado", "erro",
] as const;

const shortText = (max: number) => z.string().max(max);
const id = z.string().min(1).max(120);
const scriptLintDiagnosticSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]{1,80}$/),
  severity: z.enum(["error", "warning", "info"]),
  sectionIndex: z.number().int().min(0).max(100_000),
  section: shortText(100),
  lineStart: z.number().int().positive().max(100_001),
  lineEnd: z.number().int().positive().max(100_001),
  message: shortText(600),
  excerpt: shortText(120).optional(),
});

export const stageSchema = z.enum(STAGES);

export const trendSchema = z.object({
  id,
  title: shortText(300),
  source: z.enum(["Hacker News", "GitHub", "dev.to", "YouTube"]),
  score: z.number().min(0).max(100),
  growth: shortText(120),
  fit: shortText(300),
  gap: shortText(300),
  url: shortText(500),
  collectedAt: shortText(80),
  tags: z.array(shortText(60)).max(20),
  example: z.boolean().optional(),
});

export const ideaSchema = z.object({
  id,
  trendId: id.optional(),
  origin: z.enum(["Radar", "Projeto", "Agente"]),
  title: shortText(300),
  format: z.enum(["Longo", "Short", "Live"]),
  angle: shortText(2000),
  audience: shortText(300),
  keywords: z.array(shortText(60)).max(20),
  sourceNotes: shortText(5000).optional(),
  captureUrls: z.array(z.string().url().max(900)).max(10).optional(),
  status: stageSchema,
  createdAt: shortText(80),
  example: z.boolean().optional(),
});

export const scriptSchema = z.object({
  id,
  ideaId: id,
  version: z.number().int().min(1).max(10_000),
  title: shortText(300),
  content: z.string().max(100_000),
  status: z.enum(["Rascunho", "Aguardando aprovação", "Aprovado", "Ajuste pedido"]),
  updatedAt: shortText(80),
  qa: z.object({
    status: z.enum(["revisar", "atenção"]),
    estimatedDurationMinutes: z.number().min(0).max(240),
    technicalFlags: z.array(z.object({ excerpt: shortText(180), reason: shortText(300) })).max(8),
    repetitionFlags: z.array(z.object({ excerpt: shortText(180), reason: shortText(300) })).max(8),
    policyTerms: z.array(z.object({ term: shortText(120), context: shortText(300) })).max(8),
    originality: z.object({ demoRequired: z.literal(true), demoSpecified: z.boolean(), evidence: shortText(300), genericContentRisk: z.enum(["baixo", "médio", "alto"]) }),
    summary: shortText(500),
    classifier: z.enum(["llm", "heuristic"]),
    lintDiagnostics: z.array(scriptLintDiagnosticSchema).max(MAX_SCRIPT_LINT_DIAGNOSTICS).optional(),
  }).optional(),
  example: z.boolean().optional(),
});

export const assetSchema = z.object({
  id,
  scriptId: id,
  type: z.enum(["Tela", "Código", "Voz", "Música", "Legenda"]),
  label: shortText(300),
  license: shortText(300),
  status: z.enum(["Pronto", "Pendente", "Verificar"]),
  fileName: shortText(240).optional(),
  contentType: shortText(120).optional(),
  sizeBytes: z.number().int().positive().max(100_000_000).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  githubReleaseId: z.number().int().positive().optional(),
  githubAssetId: z.number().int().positive().optional(),
  inputAssetId: z.string().uuid().optional(),
  scriptVersion: z.number().int().positive().optional(),
  /** Índice zero-based da seção do roteiro associada a uma captura. */
  sectionIndex: z.number().int().min(0).max(29).nullable().optional(),
  example: z.boolean().optional(),
});

export const qaCheckSchema = z.object({
  label: shortText(160),
  passed: z.boolean(),
  note: shortText(500),
  /** `false` = verificação não executada (ex.: render simulado). */
  verified: z.boolean().optional(),
});

export const videoSchema = z.object({
  id,
  ideaId: id,
  scriptId: id,
  title: shortText(300),
  format: z.enum(["Longo", "Short", "Live"]),
  stage: stageSchema,
  duration: shortText(40),
  qa: z.array(qaCheckSchema).max(30),
  synthetic: z.boolean(),
  /** Vídeo produzido por render simulado (sem arquivo real). */
  simulated: z.boolean().optional(),
  renderJobId: z.string().uuid().optional(),
  releaseId: z.number().int().positive().optional(),
  assetId: z.number().int().positive().optional(),
  fileName: shortText(240).optional(),
  fileSizeBytes: z.number().int().positive().max(2_147_483_647).optional(),
  finalAssetExpiresAt: shortText(80).optional(),
  cleanupRequestedAt: shortText(80).optional(),
  scheduledFor: shortText(120).optional(),
  example: z.boolean().optional(),
});

export const renderJobSchema = z.object({
  id,
  videoId: id,
  status: z.enum(["queued", "rendering", "qa", "succeeded", "failed", "simulado"]),
  attempts: z.number().int().min(0).max(10_000),
  progress: z.number().int().min(0).max(100).optional(),
  startedAt: shortText(80).optional(),
  finishedAt: shortText(80).optional(),
  error: shortText(500).optional(),
  errorCode: shortText(100).optional(),
  errorOperation: z.enum(["manifest", "voice", "input", "callback", "render", "qa", "release", "dispatch", "worker", "unknown"]).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  upstreamStatus: z.number().int().min(100).max(599).optional(),
  quotaScope: z.enum(["rpm", "tpm", "rpd", "tpd", "unknown"]).optional(),
  quotaValue: z.number().min(0).max(1_000_000_000_000).optional(),
  quotaMetric: z.string().regex(/^[A-Za-z0-9_./:-]{1,120}$/).optional(),
  quotaId: z.string().regex(/^[A-Za-z0-9_./:-]{1,120}$/).optional(),
  retryAfterMs: z.number().int().min(0).max(604_800_000).optional(),
  providerModel: z.enum(["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]).optional(),
  simulated: z.boolean().optional(),
  workflowRunId: z.number().int().positive().optional(),
  releaseId: z.number().int().positive().optional(),
  assetId: z.number().int().positive().optional(),
  fileName: shortText(240).optional(),
  fileSizeBytes: z.number().int().positive().max(2_147_483_647).optional(),
  durationSeconds: z.number().min(0).max(86_400).optional(),
  expiresAt: shortText(80).optional(),
});

export const adapterSchema = z.object({
  id,
  capability: z.enum(["LLM", "Voz / TTS", "Transcrição", "Render", "Pesquisa"]),
  provider: shortText(160),
  plan: z.enum(["Gratuito", "Pago"]),
  active: z.boolean(),
  fallback: z.boolean(),
  status: z.enum(["Pronto", "Limite", "Desativado"]),
  example: z.boolean().optional(),
});

export const connectionSchema = z.object({
  platform: z.enum(["youtube", "tiktok"]),
  label: shortText(80),
  state: z.enum(["Não conectado", "Pronto para conectar", "Aguardando credenciais", "Conectado"]),
  detail: shortText(500),
  enabled: z.boolean(),
});

export const auditEntrySchema = z.object({
  id,
  actor: z.enum(["Você", "Nexo", "Sistema"]),
  action: shortText(200),
  target: shortText(300),
  at: shortText(80),
  detail: shortText(1000).optional(),
  example: z.boolean().optional(),
});

export const chatMessageSchema = z.object({
  id,
  sender: z.enum(["nexo", "user"]),
  text: z.string().max(20_000),
  at: shortText(80),
  actions: z.array(z.unknown()).max(20).optional(),
});

export const studioSettingsSchema = z.object({
  automation: z.object({
    radar: z.enum(["Automática", "Manual"]),
    roteiro: z.enum(["Automática", "Manual"]),
    producao: z.enum(["Automática", "Manual"]),
    publicacao: z.enum(["Automática", "Manual"]),
  }),
  weeklyGoal: z.object({ longos: z.number().int().min(0).max(50), shorts: z.number().int().min(0).max(200), lives: z.number().int().min(0).max(50) }),
  monthlyCap: z.number().min(0).max(1_000_000),
  voiceMode: z.enum(["TTS", "Sua voz", "Música + texto"]),
  autonomy: z.enum(["Revisão total", "Amostra"]),
  /** Modo demonstração explícito: permite validar o fluxo com render simulado. */
  demoMode: z.boolean().optional(),
});

export const studioStateSchema = z.object({
  /** Versão de concorrência. O servidor sempre grava `versão lida + 1`. */
  version: z.number().int().min(0).max(1_000_000_000).optional(),
  trends: z.array(trendSchema).max(300),
  ideas: z.array(ideaSchema).max(500),
  scripts: z.array(scriptSchema).max(500),
  assets: z.array(assetSchema).max(1000),
  videos: z.array(videoSchema).max(500),
  renderJobs: z.array(renderJobSchema).max(500),
  adapters: z.array(adapterSchema).max(60),
  connections: z.array(connectionSchema).max(10),
  settings: studioSettingsSchema,
  audit: z.array(auditEntrySchema).max(500),
  chat: z.array(chatMessageSchema).max(300),
  /** Mapa studioScriptId/ideaId → scripts.id numérico no Neon (Portão 1 → 1.5). */
  persistedScriptIds: z.record(z.string().min(1).max(120), z.number().int().positive().max(1_000_000_000)).optional(),
});

export type ValidatedStudioState = z.infer<typeof studioStateSchema>;

export class StateTooLargeError extends Error {
  constructor() { super(`O estado enviado excede o limite de ${Math.round(MAX_STATE_BYTES / 1024)} KB. Reduza o conteúdo e tente novamente.`); this.name = "StateTooLargeError"; }
}

/** Valida tamanho e formato antes de qualquer gravação no Neon. */
export function parseStudioState(input: unknown): ValidatedStudioState {
  const size = Buffer.byteLength(JSON.stringify(input ?? null), "utf8");
  if (size > MAX_STATE_BYTES) throw new StateTooLargeError();
  const parsed = studioStateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "estado";
    throw new Error(`Estado inválido em “${path}”: ${issue?.message ?? "formato inesperado"}.`);
  }
  return parsed.data;
}
