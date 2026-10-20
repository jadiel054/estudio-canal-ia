/**
 * Contrato público TTS para o router/UI.
 * Mantém settings tipados e amostra sem acoplar a implementação interna do provider.
 */
import {
  generateSpeechCached,
  getTtsSettings,
  ttsSettingsSchema,
  TTS_NARRATION_STYLE,
  TTS_MODELS,
  TTS_VOICES,
  type TtsSettings,
  type TtsModel,
} from "./ttsProvider";

export type TtsVoice = typeof TTS_VOICES[number];

/** Resposta pública de `tts.settings` — sem segredos. */
export type TtsSettingsResponse = TtsSettings & {
  configured: boolean;
  dataPolicy: string;
};

/** Resposta pública de `tts.test` / amostra de voz. */
export type TtsSampleResponse = {
  audioBase64: string;
  contentType: "audio/wav";
  model: TtsModel;
  voice: TtsVoice;
  fallback: boolean;
  bytes: number;
};

export const TTS_DATA_POLICY =
  "O nível gratuito pode usar entradas e saídas para melhoria de produtos e revisão humana; não envie dados sensíveis.";

/** Monta a resposta tipada de settings sem revelar a chave. */
export async function getTtsSettingsResponse(): Promise<TtsSettingsResponse> {
  const settings = await getTtsSettings();
  return {
    ...settings,
    configured: Boolean(process.env.STUDIO_LLM_GEMINI_KEY),
    dataPolicy: TTS_DATA_POLICY,
  };
}

/** Gera amostra curta de voz para a UI (rate-limited no router). */
export async function generateTtsSample(settings?: TtsSettings): Promise<TtsSampleResponse> {
  const resolved = settings ?? (await getTtsSettings());
  const result = await generateSpeechCached(
    "Olá! Este é um teste de voz em português brasileiro para o Estúdio de Canal IA.",
    resolved,
    TTS_NARRATION_STYLE,
    "connection_test",
  );
  return {
    audioBase64: result.audio.toString("base64"),
    contentType: "audio/wav",
    model: result.model,
    voice: result.voice,
    fallback: result.fallback,
    bytes: result.audio.length,
  };
}

export { ttsSettingsSchema, getTtsSettings, TTS_MODELS, TTS_VOICES, TTS_NARRATION_STYLE };
export type { TtsSettings, TtsModel };
