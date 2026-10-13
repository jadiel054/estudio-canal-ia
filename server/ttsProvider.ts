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

export class TtsProviderError extends Error {
  constructor(message: string, readonly status?: number) {
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

async function generateWithModel(text: string, model: TtsModel, voice: typeof TTS_VOICES[number], style: string): Promise<Buffer> {
  const key = process.env.STUDIO_LLM_GEMINI_KEY;
  if (!key) throw new TtsProviderError("A chave Gemini não está configurada no ambiente do Estúdio.");

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
        response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24_000 },
        generation_config: { speech_config: [{ voice }] },
      }),
    });
    if (!response.ok) throw new TtsProviderError(`Gemini TTS indisponível (HTTP ${response.status}).`, response.status);
    const data = await response.json() as { output_audio?: { data?: string; mime_type?: string } };
    const encoded = data.output_audio?.data;
    if (typeof encoded !== "string" || encoded.length < 100) throw new TtsProviderError("Gemini TTS retornou áudio vazio ou inválido.");
    const audio = Buffer.from(encoded, "base64");
    if (audio.length < 64 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
      throw new TtsProviderError("Gemini TTS retornou um arquivo que não é WAV válido.");
    }
    return audio;
  } catch (error) {
    if (error instanceof TtsProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new TtsProviderError("Tempo limite do Gemini TTS excedido.");
    throw new TtsProviderError("Falha de rede ao gerar voz no Gemini TTS.");
  } finally {
    clearTimeout(timer);
  }
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
    throw new TtsProviderError(`Gemini TTS principal e fallback falharam. ${detail}`);
  }
}
