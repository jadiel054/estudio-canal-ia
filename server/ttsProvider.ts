import { z } from "zod";
import { readStudioSetting, writeStudioSetting } from "./studioRepository";

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

type TtsFailureKind = "invalid_key" | "unavailable" | "invalid_audio" | "network" | "timeout";

export class TtsProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly kind: TtsFailureKind = "unavailable") {
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

/**
 * Mantém a observabilidade útil sem registrar prompts, áudio base64 ou o corpo
 * integral do provedor. Os campos permitidos são somente estrutura e erro curto.
 */
function summarizeResponseBody(body: unknown): string {
  if (!isRecord(body)) return "corpo não-JSON ou vazio";

  const summary: JsonRecord = {
    keys: Object.keys(body).slice(0, 24),
  };
  if (Array.isArray(body.steps)) {
    summary.steps = body.steps.slice(-6).map(step => {
      if (!isRecord(step)) return { type: "desconhecido", contentTypes: [] };
      const content = Array.isArray(step.content) ? step.content : [];
      return {
        type: safeString(step.type, 60) ?? "desconhecido",
        contentTypes: content.slice(-12).map(item => isRecord(item) ? safeString(item.type, 60) ?? "desconhecido" : "desconhecido"),
      };
    });
  }
  if (Array.isArray(body.candidates)) {
    summary.candidates = body.candidates.slice(0, 4).map(candidate => {
      if (!isRecord(candidate)) return { contentTypes: [] };
      const content = isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
      return { contentTypes: content.slice(0, 12).map(part => isRecord(part) ? (part.inlineData ? "inline_data" : part.text ? "text" : "desconhecido") : "desconhecido") };
    });
  }
  if (isRecord(body.error)) {
    summary.error = {
      code: typeof body.error.code === "number" ? body.error.code : undefined,
      status: safeString(body.error.status, 80),
      message: safeString(body.error.message, 240),
    };
  }
  return JSON.stringify(summary);
}

function logMissingAudio(status: number, body: unknown) {
  console.warn("[Gemini TTS] Resposta sem áudio", { status, summary: summarizeResponseBody(body) });
}

function findAudioBlock(body: unknown): AudioBlock | undefined {
  if (!isRecord(body)) return undefined;

  // Compatibilidade defensiva com a propriedade de conveniência de SDKs. O
  // REST bruto documentado usa steps[].content[].data abaixo.
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
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  } catch {
    return undefined;
  }
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
  return {
    valid: sampleRate === EXPECTED_SAMPLE_RATE && channels === 1 && bitsPerSample === 16 && hasData,
    sampleRate,
    channels,
    bitsPerSample,
  };
}

async function generateWithModel(text: string, model: TtsModel, voice: typeof TTS_VOICES[number], style: string): Promise<Buffer> {
  const key = process.env.STUDIO_LLM_GEMINI_KEY;
  if (!key) throw new TtsProviderError("A chave Gemini não está configurada no ambiente do Estúdio.", undefined, "invalid_key");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model,
        input: [{
          type: "user_input",
          content: [{
            type: "text",
            text,
            annotations: [{ type: "speech_metadata", style }],
          }],
        }],
        response_format: { type: "audio", mime_type: "audio/wav", sample_rate: EXPECTED_SAMPLE_RATE },
        generation_config: { speech_config: [{ voice }] },
        store: false,
      }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      logMissingAudio(response.status, body);
      const invalidKey = response.status === 401 || response.status === 403;
      throw new TtsProviderError(`Gemini TTS indisponível (HTTP ${response.status}).`, response.status, invalidKey ? "invalid_key" : "unavailable");
    }

    const audioBlock = findAudioBlock(body);
    if (!audioBlock || audioBlock.data.length < 100) {
      logMissingAudio(response.status, body);
      throw new TtsProviderError("Gemini TTS retornou áudio vazio ou inválido.", response.status, "unavailable");
    }

    let audio: Buffer;
    try {
      audio = Buffer.from(audioBlock.data, "base64");
    } catch {
      throw new TtsProviderError("Gemini TTS retornou áudio base64 inválido.", response.status, "invalid_audio");
    }
    const wav = inspectWav(audio);
    if (!wav.valid) {
      throw new TtsProviderError(`Gemini TTS retornou um arquivo que não é WAV válido a ${EXPECTED_SAMPLE_RATE / 1000} kHz.`, response.status, "invalid_audio");
    }
    return audio;
  } catch (error) {
    if (error instanceof TtsProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new TtsProviderError("Tempo limite do Gemini TTS excedido.", undefined, "timeout");
    throw new TtsProviderError("Falha de rede ao gerar voz no Gemini TTS.", undefined, "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Testa a chave e os dois modelos sem expor o áudio ao cliente. */
export async function testTtsConnection(settings: TtsSettings = DEFAULT_TTS_SETTINGS): Promise<TtsConnectionResult> {
  const started = Date.now();
  if (!process.env.STUDIO_LLM_GEMINI_KEY) {
    return { ok: false, status: "not_configured", latencyMs: Date.now() - started, message: "A chave Gemini não está configurada no ambiente do Estúdio." };
  }
  const validated = ttsSettingsSchema.safeParse(settings);
  if (!validated.success) return { ok: false, status: "tts_unavailable", latencyMs: Date.now() - started, message: "Configuração do adaptador TTS inválida." };

  const models = [validated.data.primaryModel, validated.data.fallbackModel] as const;
  const failures: TtsProviderError[] = [];
  for (const [index, model] of models.entries()) {
    try {
      await generateWithModel("Conexão TTS OK.", model, validated.data.voice, "Português brasileiro neutro, natural e claro.");
      return { ok: true, status: "ok", model, fallback: index === 1, latencyMs: Date.now() - started, message: index === 1 ? "Conexão OK pelo fallback TTS." : "Conexão OK pelo modelo principal." };
    } catch (error) {
      failures.push(error instanceof TtsProviderError ? error : new TtsProviderError("Falha de conexão ao testar TTS.", undefined, "network"));
    }
  }

  if (failures.some(error => error.kind === "invalid_key" || error.status === 401 || error.status === 403)) {
    return { ok: false, status: "invalid_key", latencyMs: Date.now() - started, message: "A chave Gemini foi recusada ou não tem permissão para o TTS." };
  }
  return { ok: false, status: "tts_unavailable", latencyMs: Date.now() - started, message: "A chave Gemini não foi recusada, mas o TTS está indisponível nos modelos configurados." };
}

/** Gera somente texto fornecido pelo servidor, usando principal e fallback sem expor a chave. */
export async function generateSpeech(text: string, settings: TtsSettings = DEFAULT_TTS_SETTINGS, style = "Português brasileiro neutro, natural e claro; ritmo de tutorial técnico, sem música e sem efeitos."): Promise<SpeechResult> {
  const clean = text.trim();
  if (!clean || clean.length > MAX_TEXT_CHARS) throw new TtsProviderError(`O trecho de narração deve ter entre 1 e ${MAX_TEXT_CHARS} caracteres.`);
  const validated = ttsSettingsSchema.safeParse(settings);
  if (!validated.success) throw new TtsProviderError("Configuração do adaptador TTS inválida.");

  let firstError: unknown;
  try {
    const audio = await generateWithModel(clean, validated.data.primaryModel, validated.data.voice, style);
    return { audio, contentType: "audio/wav", model: validated.data.primaryModel, voice: validated.data.voice, fallback: false };
  } catch (error) {
    firstError = error;
  }
  try {
    const audio = await generateWithModel(clean, validated.data.fallbackModel, validated.data.voice, style);
    return { audio, contentType: "audio/wav", model: validated.data.fallbackModel, voice: validated.data.voice, fallback: true };
  } catch {
    const detail = firstError instanceof TtsProviderError ? firstError.message : "provedor principal indisponível";
    const first = firstError instanceof TtsProviderError ? firstError : undefined;
    throw new TtsProviderError(`Gemini TTS principal e fallback falharam. ${detail}`, first?.status, first?.kind);
  }
}
