import { z } from "zod";
import { readStudioSetting, writeStudioSetting } from "./studioRepository";
import { getCachedTtsAudio, saveCachedTtsAudio, ttsAudioCacheKey } from "./ttsCache";
import { recordTtsApiCall, type TtsApiUsageEvent, type TtsPurpose, type TtsQuotaScope } from "./ttsUsage";

export const TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"] as const;
export const TTS_VOICES = ["Kore", "Aoede", "Charon", "Fenrir", "Orus"] as const;
export const DEFAULT_TTS_SETTINGS = {
  primaryModel: "gemini-3.8-flash-tts",
  fallbackModel: "gemini-3.8-flash-lite-tts",
  voice: "Kore",
} as const;
export const ttsSettingsSchema = z.object({
  primaryModel: z.enum(TTS_MODELS),
  fallbackModel: z.enum(TTS_MODELS),
  voice: z.enum(TTS_VOICES),
}).refine(value => value.primaryModel !== value.fallbackModel, {
  message: "O fallback deve ser diferente do provedor principal.",
  path: ["fallbackModel"],
});
export type TtsSettings = z.infer<typeof ttsSettingsSchema>;
export type TtsModel = typeof TTS_MODELS[number];
const TTS_SETTINGS_KEY = "tts_provider_settings";

export async function getTtsSettings(): Promise<TtsSettings> {
  const stored = await readStudioSetting<unknown>(TTS_SETTINGS_KEY);
  const parsed = ttsSettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_TTS_SETTINGS;
}

export async function updateTtsSettings(value: TtsSettings): Promise<TtsSettings> {
  const parsed = ttsSettingsSchema.safeParse(value);
  if (!parsed.success) throw new TtsProviderError("Configuração do adaptador TTS inválida.");
  await writeStudioSetting(TTS_SETTINGS_KEY, parsed.data);
  return parsed.data;
}

const TIMEOUT_MS = 45_000;
const MAX_TEXT_CHARS = 2_000;
const EXPECTED_SAMPLE_RATE = 24_000;
export const MAX_TTS_ATTEMPTS_PER_MODEL = 3; // chamada inicial + até 2 retries
const MAX_INLINE_RETRY_DELAY_MS = 30_000;
export const TTS_NARRATION_STYLE = "Português brasileiro neutro, natural e claro; ritmo de tutorial técnico, sem música e sem efeitos.";

type TtsFailureKind = "invalid_key" | "unavailable" | "invalid_audio" | "network" | "timeout" | "quota_daily" | "quota_minute" | "quota_unknown";
export type TtsQuotaDiagnostic = {
  scope: TtsQuotaScope;
  value?: number;
  metric?: string;
  id?: string;
  retryAfterMs?: number;
};

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: TtsFailureKind = "unavailable",
    readonly model?: TtsModel,
    readonly quota?: TtsQuotaDiagnostic,
  ) {
    super(message);
    this.name = "TtsProviderError";
  }
}

export type SpeechResult = {
  audio: Buffer;
  contentType: "audio/wav";
  model: TtsModel;
  voice: typeof TTS_VOICES[number];
  fallback: boolean;
  cached?: boolean;
};

export type TtsConnectionStatus = "ok" | "not_configured" | "invalid_key" | "tts_unavailable";
export type TtsConnectionResult =
  | { ok: true; status: "ok"; model: TtsModel; fallback: boolean; latencyMs: number; message: string }
  | { ok: false; status: Exclude<TtsConnectionStatus, "ok">; latencyMs: number; message: string };

type JsonRecord = Record<string, unknown>;
type AudioBlock = { data: string; mimeType?: string };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, maxLength = 180): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/(?:AIza|gh[opsu]_|xox[baprs]-|sk-)[A-Za-z0-9_-]+/gi, "[redacted]")
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, maxLength);
}

function safeQuotaIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return /^[A-Za-z0-9_./:-]{1,120}$/.test(cleaned) ? cleaned : undefined;
}

function safeQuotaValue(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1_000_000_000_000 ? numeric : undefined;
}

function parseRetryAfterHeader(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(604_800_000, Math.round(seconds * 1_000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(604_800_000, timestamp - now)) : undefined;
}

function parseDuration(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 1_000);
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? Math.min(604_800_000, Math.round(Number(match[1]) * 1_000)) : undefined;
}

function classifyQuotaScope(metric?: string, id?: string, providerDescription?: string): TtsQuotaScope {
  const value = `${metric ?? ""} ${id ?? ""} ${providerDescription ?? ""}`.toLowerCase();
  const tokenMetric = /token|\btpm\b|\btpd\b/.test(value);
  const minute = /per[_/ .-]*minute|requests?[_/ .-]*per[_/ .-]*min|tokens?[_/ .-]*per[_/ .-]*min|\brpm\b|\btpm\b|minute limit/.test(value);
  const daily = /per[_/ .-]*day|requests?[_/ .-]*per[_/ .-]*day|tokens?[_/ .-]*per[_/ .-]*day|\brpd\b|\btpd\b|daily limit|daily quota/.test(value);
  if (daily) return tokenMetric ? "tpd" : "rpd";
  if (minute) return tokenMetric ? "tpm" : "rpm";
  return "unknown";
}

/** Extrai apenas identificadores e números permitidos; nunca retorna a mensagem bruta do provedor. */
export function parseTtsQuotaDiagnostic(body: unknown, retryAfterHeader?: string | null, now = Date.now()): TtsQuotaDiagnostic {
  const root = isRecord(body) ? body : {};
  const error = isRecord(root.error) ? root.error : {};
  const detailList = Array.isArray(error.details) ? error.details : Array.isArray(root.details) ? root.details : [];
  const quotaDetail = detailList.find(detail => isRecord(detail) && /QuotaFailure/i.test(String(detail["@type"] ?? detail.type ?? "")));
  const retryDetail = detailList.find(detail => isRecord(detail) && /RetryInfo/i.test(String(detail["@type"] ?? detail.type ?? "")));
  const quotaObject = isRecord(quotaDetail) ? (isRecord(quotaDetail.quotaFailure) ? quotaDetail.quotaFailure : quotaDetail) : {};
  const violations = Array.isArray(quotaObject.violations) ? quotaObject.violations : [];
  const violation = violations.find(isRecord) ?? {};
  const metric = safeQuotaIdentifier(violation.quotaMetric ?? violation.quota_metric);
  const id = safeQuotaIdentifier(violation.quotaId ?? violation.quota_id);
  const descriptionForClassification = typeof violation.description === "string" ? violation.description.slice(0, 300) : typeof error.message === "string" ? error.message.slice(0, 300) : "";
  const retryObject = isRecord(retryDetail) ? (isRecord(retryDetail.retryInfo) ? retryDetail.retryInfo : retryDetail) : {};
  const retryDelay = parseDuration(retryObject.retryDelay ?? retryObject.retry_delay);
  const headerDelay = parseRetryAfterHeader(retryAfterHeader, now);
  const delayValues = [retryDelay, headerDelay].filter((value): value is number => value !== undefined);
  return {
    scope: classifyQuotaScope(metric, id, descriptionForClassification),
    ...(safeQuotaValue(violation.quotaValue ?? violation.quota_value) !== undefined ? { value: safeQuotaValue(violation.quotaValue ?? violation.quota_value) } : {}),
    ...(metric ? { metric } : {}),
    ...(id ? { id } : {}),
    ...(delayValues.length ? { retryAfterMs: Math.max(...delayValues) } : {}),
  };
}

function quotaKind(scope: TtsQuotaScope): TtsFailureKind {
  return scope === "rpd" || scope === "tpd" ? "quota_daily" : scope === "rpm" || scope === "tpm" ? "quota_minute" : "quota_unknown";
}

function safeQuotaLog(model: TtsModel, status: number, quota: TtsQuotaDiagnostic) {
  console.warn(JSON.stringify({
    event: "falha_quota_tts_gemini",
    model,
    httpStatus: status,
    quotaScope: quota.scope,
    ...(quota.value !== undefined ? { quotaValue: quota.value } : {}),
    ...(quota.metric ? { quotaMetric: quota.metric } : {}),
    ...(quota.id ? { quotaId: quota.id } : {}),
    ...(quota.retryAfterMs !== undefined ? { retryAfterMs: quota.retryAfterMs } : {}),
  }));
}

function summarizeResponseBody(body: unknown): string {
  if (!isRecord(body)) return "corpo não-JSON ou vazio";
  const allowedRootKeys = new Set(["id", "steps", "output_audio", "candidates", "error", "usage", "model"]);
  const allowedStepTypes = new Set(["model_output", "user_input", "tool_call", "tool_output"]);
  const allowedContentTypes = new Set(["audio", "text", "image", "video", "input_audio"]);
  const summary: JsonRecord = { keys: Object.keys(body).filter(key => allowedRootKeys.has(key)) };
  if (Array.isArray(body.steps)) {
    summary.steps = body.steps.slice(-6).map(step => {
      if (!isRecord(step)) return { type: "desconhecido", contentTypes: [] };
      const content = Array.isArray(step.content) ? step.content : [];
      return {
        type: typeof step.type === "string" && allowedStepTypes.has(step.type) ? step.type : "outro",
        contentTypes: content.slice(-12).map(item => isRecord(item) && typeof item.type === "string" && allowedContentTypes.has(item.type) ? item.type : "outro"),
      };
    });
  }
  if (Array.isArray(body.candidates)) {
    summary.candidates = body.candidates.slice(0, 4).map(candidate => {
      if (!isRecord(candidate)) return { contentTypes: [] };
      const content = isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
      return { contentTypes: content.slice(0, 12).map(part => isRecord(part) ? (part.inlineData ? "inline_data" : part.text ? "text" : "outro") : "outro") };
    });
  }
  if (isRecord(body.error)) {
    const allowedStatuses = new Set(["INVALID_ARGUMENT", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "NOT_FOUND", "UNAUTHENTICATED", "FAILED_PRECONDITION", "DEADLINE_EXCEEDED"]);
    summary.error = { code: typeof body.error.code === "number" && Number.isInteger(body.error.code) ? body.error.code : undefined, status: typeof body.error.status === "string" && allowedStatuses.has(body.error.status) ? body.error.status : "outro" };
  }
  return JSON.stringify(summary);
}

function logMissingAudio(status: number, body: unknown) {
  console.warn("[Gemini TTS] Resposta sem áudio", { status, summary: summarizeResponseBody(body) });
}

function findAudioBlock(body: unknown): AudioBlock | undefined {
  if (!isRecord(body)) return undefined;
  if (isRecord(body.output_audio) && typeof body.output_audio.data === "string") {
    return { data: body.output_audio.data, mimeType: safeString(body.output_audio.mime_type, 80) };
  }
  if (!Array.isArray(body.steps)) return undefined;
  for (let stepIndex = body.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = body.steps[stepIndex];
    if (!isRecord(step) || !Array.isArray(step.content)) continue;
    for (let contentIndex = step.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const content = step.content[contentIndex];
      if (!isRecord(content) || content.type !== "audio" || typeof content.data !== "string") continue;
      return { data: content.data, mimeType: safeString(content.mime_type, 80) };
    }
  }
  return undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    const raw = await response.text();
    if (!raw.trim()) return undefined;
    try { return JSON.parse(raw) as unknown; }
    catch { return raw; }
  } catch { return undefined; }
}

function inspectWav(audio: Buffer): { valid: boolean; sampleRate?: number; channels?: number; bitsPerSample?: number } {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return { valid: false };
  let offset = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let hasData = false;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > audio.length) break;
    if (chunkId === "fmt " && chunkSize >= 16) {
      channels = audio.readUInt16LE(chunkStart + 2);
      sampleRate = audio.readUInt32LE(chunkStart + 4);
      bitsPerSample = audio.readUInt16LE(chunkStart + 14);
    }
    if (chunkId === "data") hasData = chunkSize > 0;
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  return { valid: sampleRate === EXPECTED_SAMPLE_RATE && channels === 1 && bitsPerSample === 16 && hasData, sampleRate, channels, bitsPerSample };
}

function usageEvent(model: TtsModel, purpose: TtsPurpose, outcome: "success" | "failure", status?: number, quota?: TtsQuotaDiagnostic): TtsApiUsageEvent {
  return {
    model, purpose, outcome,
    ...(status !== undefined ? { httpStatus: status } : {}),
    ...(quota ? {
      quotaScope: quota.scope,
      ...(quota.value !== undefined ? { quotaValue: quota.value } : {}),
      ...(quota.metric ? { quotaMetric: quota.metric } : {}),
      ...(quota.id ? { quotaId: quota.id } : {}),
      ...(quota.retryAfterMs !== undefined ? { retryAfterMs: quota.retryAfterMs } : {}),
    } : {}),
  };
}

async function generateWithModel(text: string, model: TtsModel, voice: typeof TTS_VOICES[number], style: string, purpose: TtsPurpose): Promise<Buffer> {
  const key = process.env.STUDIO_LLM_GEMINI_KEY;
  if (!key) throw new TtsProviderError("A chave Gemini não está configurada no ambiente do Estúdio.", undefined, "invalid_key", model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let recorded = false;
  let responseStatus: number | undefined;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model,
        input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style }] }] }],
        response_format: { type: "audio", mime_type: "audio/wav", sample_rate: EXPECTED_SAMPLE_RATE },
        generation_config: { speech_config: [{ voice }] },
        store: false,
      }),
    });
    responseStatus = response.status;
    const body = await readResponseBody(response);
    if (!response.ok) {
      const invalidKey = response.status === 401 || response.status === 403;
      const retryAfterMs = parseRetryAfterHeader(response.headers?.get("Retry-After"));
      const quota = response.status === 429 ? parseTtsQuotaDiagnostic(body, response.headers?.get("Retry-After")) : retryAfterMs !== undefined ? { scope: "unknown" as const, retryAfterMs } : undefined;
      const kind = response.status === 429 ? quotaKind(quota?.scope ?? "unknown") : invalidKey ? "invalid_key" : "unavailable";
      if (response.status === 429 && quota) safeQuotaLog(model, response.status, quota);
      await recordTtsApiCall(usageEvent(model, purpose, "failure", response.status, quota));
      recorded = true;
      throw new TtsProviderError(
        response.status === 429 ? "Gemini TTS respondeu com limite de uso." : `Gemini TTS indisponível (HTTP ${response.status}).`,
        response.status, kind, model, quota,
      );
    }

    const audioBlock = findAudioBlock(body);
    if (!audioBlock || audioBlock.data.length < 100) {
      logMissingAudio(response.status, body);
      await recordTtsApiCall(usageEvent(model, purpose, "failure", response.status));
      recorded = true;
      throw new TtsProviderError("Gemini TTS retornou áudio vazio ou inválido.", response.status, "unavailable", model);
    }

    let audio: Buffer;
    try { audio = Buffer.from(audioBlock.data, "base64"); }
    catch { throw new TtsProviderError("Gemini TTS retornou áudio base64 inválido.", response.status, "invalid_audio", model); }
    const wav = inspectWav(audio);
    if (!wav.valid) throw new TtsProviderError(`Gemini TTS retornou um arquivo que não é WAV válido a ${EXPECTED_SAMPLE_RATE / 1000} kHz.`, response.status, "invalid_audio", model);
    await recordTtsApiCall(usageEvent(model, purpose, "success", response.status));
    recorded = true;
    return audio;
  } catch (error) {
    if (!recorded) {
      const typed = error instanceof TtsProviderError ? error : undefined;
      await recordTtsApiCall(usageEvent(model, purpose, "failure", responseStatus, typed?.quota));
    }
    if (error instanceof TtsProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new TtsProviderError("Tempo limite do Gemini TTS excedido.", responseStatus, "timeout", model);
    throw new TtsProviderError("Falha de rede ao gerar voz no Gemini TTS.", responseStatus, "network", model);
  } finally {
    clearTimeout(timer);
  }
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
function retryDelay(error: TtsProviderError, retryNumber: number): number | undefined {
  const advised = error.quota?.retryAfterMs;
  if (advised !== undefined && advised > MAX_INLINE_RETRY_DELAY_MS) return undefined;
  const exponential = 1_000 * 2 ** retryNumber;
  const jitter = Math.floor(Math.random() * Math.min(250, exponential * 0.2));
  const delay = Math.max(exponential, advised ?? 0) + jitter;
  return delay <= MAX_INLINE_RETRY_DELAY_MS ? delay : undefined;
}
function isRetryable(error: TtsProviderError): boolean {
  if (error.kind === "quota_minute") return true;
  if (error.kind === "network" || error.kind === "timeout") return true;
  return error.kind === "unavailable" && [500, 502, 503, 504].includes(error.status ?? 0);
}

async function generateWithRetry(text: string, model: TtsModel, voice: typeof TTS_VOICES[number], style: string, purpose: TtsPurpose): Promise<Buffer> {
  let lastError: TtsProviderError | undefined;
  for (let attempt = 0; attempt < MAX_TTS_ATTEMPTS_PER_MODEL; attempt += 1) {
    try { return await generateWithModel(text, model, voice, style, purpose); }
    catch (error) {
      lastError = error instanceof TtsProviderError ? error : new TtsProviderError("Falha temporária no Gemini TTS.", undefined, "network", model);
      if (!isRetryable(lastError) || attempt === MAX_TTS_ATTEMPTS_PER_MODEL - 1) throw lastError;
      const delay = retryDelay(lastError, attempt);
      // Se o provedor recomenda uma espera longa, paramos em vez de desrespeitar Retry-After.
      if (delay === undefined) throw lastError;
      await wait(delay);
    }
  }
  throw lastError ?? new TtsProviderError("Gemini TTS indisponível.", undefined, "unavailable", model);
}

function preferredFailure(errors: TtsProviderError[]): TtsProviderError {
  const selected = errors.find(error => error.kind === "quota_daily")
    ?? errors.find(error => error.kind === "quota_minute")
    ?? errors.find(error => error.kind === "quota_unknown")
    ?? errors[0];
  if (!selected) return new TtsProviderError("Gemini TTS principal e fallback falharam.");
  if (selected.kind === "quota_daily") return new TtsProviderError("A quota diária Gemini TTS foi atingida nos modelos configurados.", selected.status, selected.kind, selected.model, selected.quota);
  if (selected.kind === "quota_minute") return new TtsProviderError("O limite de janela curta do Gemini TTS foi atingido; aguarde o intervalo indicado antes de tentar novamente.", selected.status, selected.kind, selected.model, selected.quota);
  if (selected.kind === "quota_unknown") return new TtsProviderError("Gemini TTS retornou HTTP 429, mas a resposta não identificou a dimensão da quota.", selected.status, selected.kind, selected.model, selected.quota);
  return new TtsProviderError("Gemini TTS principal e fallback falharam.", selected.status, selected.kind, selected.model, selected.quota);
}

async function generateAcrossModels(text: string, settings: TtsSettings, style: string, purpose: TtsPurpose): Promise<SpeechResult> {
  const errors: TtsProviderError[] = [];
  const models = [settings.primaryModel, settings.fallbackModel] as const;
  for (const [index, model] of models.entries()) {
    try {
      const audio = await generateWithRetry(text, model, settings.voice, style, purpose);
      return { audio, contentType: "audio/wav", model, voice: settings.voice, fallback: index === 1, cached: false };
    } catch (error) {
      const typed = error instanceof TtsProviderError ? error : new TtsProviderError("Falha de rede ao gerar voz no Gemini TTS.", undefined, "network", model);
      errors.push(typed);
      if (typed.kind === "invalid_key") break;
    }
  }
  throw preferredFailure(errors);
}

/** Gera narração usando principal/fallback. Chamadas de quota curta recebem retry/backoff limitado. */
export async function generateSpeech(
  text: string,
  settings: TtsSettings = DEFAULT_TTS_SETTINGS,
  style = TTS_NARRATION_STYLE,
  purpose: TtsPurpose = "render",
): Promise<SpeechResult> {
  const clean = text.trim();
  if (!clean || clean.length > MAX_TEXT_CHARS) throw new TtsProviderError(`O trecho de narração deve ter entre 1 e ${MAX_TEXT_CHARS} caracteres.`);
  const validated = ttsSettingsSchema.safeParse(settings);
  if (!validated.success) throw new TtsProviderError("Configuração do adaptador TTS inválida.");
  return generateAcrossModels(clean, validated.data, style, purpose);
}

/** Cache compartilhado por conteúdo/modelo/voz/estilo; somente o hash da fala é a chave persistida. */
export async function generateSpeechCached(
  text: string,
  settings: TtsSettings = DEFAULT_TTS_SETTINGS,
  style = TTS_NARRATION_STYLE,
): Promise<SpeechResult> {
  const clean = text.trim();
  if (!clean || clean.length > MAX_TEXT_CHARS) throw new TtsProviderError(`O trecho de narração deve ter entre 1 e ${MAX_TEXT_CHARS} caracteres.`);
  const validated = ttsSettingsSchema.safeParse(settings);
  if (!validated.success) throw new TtsProviderError("Configuração do adaptador TTS inválida.");
  const models = [validated.data.primaryModel, validated.data.fallbackModel] as const;
  for (const [index, model] of models.entries()) {
    const cacheKey = ttsAudioCacheKey({ text: clean, model, voice: validated.data.voice, style });
    const cached = await getCachedTtsAudio(cacheKey, model);
    if (cached) return { audio: cached, contentType: "audio/wav", model, voice: validated.data.voice, fallback: index === 1, cached: true };
  }
  const generated = await generateAcrossModels(clean, validated.data, style, "render");
  const cacheKey = ttsAudioCacheKey({ text: clean, model: generated.model, voice: generated.voice, style });
  await saveCachedTtsAudio({ cacheKey, model: generated.model, voice: generated.voice, audio: generated.audio });
  return generated;
}

/** Testa a chave e os dois modelos sem expor o áudio ao cliente. */
export async function testTtsConnection(settings: TtsSettings = DEFAULT_TTS_SETTINGS): Promise<TtsConnectionResult> {
  const started = Date.now();
  if (!process.env.STUDIO_LLM_GEMINI_KEY) return { ok: false, status: "not_configured", latencyMs: Date.now() - started, message: "A chave Gemini não está configurada no ambiente do Estúdio." };
  const validated = ttsSettingsSchema.safeParse(settings);
  if (!validated.success) return { ok: false, status: "tts_unavailable", latencyMs: Date.now() - started, message: "Configuração do adaptador TTS inválida." };
  const models = [validated.data.primaryModel, validated.data.fallbackModel] as const;
  for (const [index, model] of models.entries()) {
    try {
      await generateWithRetry("Conexão TTS OK.", model, validated.data.voice, "Português brasileiro neutro, natural e claro.", "connection_test");
      return { ok: true, status: "ok", model, fallback: index === 1, latencyMs: Date.now() - started, message: index === 1 ? "Conexão OK pelo fallback TTS." : "Conexão OK pelo modelo principal." };
    } catch (error) {
      if (error instanceof TtsProviderError && error.kind === "invalid_key") return { ok: false, status: "invalid_key", latencyMs: Date.now() - started, message: "A chave Gemini foi recusada ou não tem permissão para o TTS." };
    }
  }
  return { ok: false, status: "tts_unavailable", latencyMs: Date.now() - started, message: "A chave Gemini não foi recusada, mas o TTS está indisponível ou sem quota nos modelos configurados." };
}
