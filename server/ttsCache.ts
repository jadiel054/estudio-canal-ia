import { createHash } from "node:crypto";
import { getStudioPool } from "./studioRepository";
import { recordTtsCacheHit } from "./ttsUsage";

export const TTS_CACHE_TTL_DAYS = 7;
export type TtsCacheModel = "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts";
export type TtsCacheVoice = "Kore" | "Aoede" | "Charon" | "Fenrir" | "Orus";
let warnedUnavailable = false;
function warnUnavailable() {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn("[Gemini TTS] cache Neon indisponível; geração seguirá sem reaproveitamento");
}

export function ttsAudioCacheKey(value: { text: string; model: TtsCacheModel; voice: TtsCacheVoice; style: string }): string {
  const stable = JSON.stringify(["tts-cache-v1", value.model, value.voice, value.style, value.text.trim()]);
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

export async function getCachedTtsAudio(cacheKey: string, model: TtsCacheModel): Promise<Buffer | undefined> {
  const pool = getStudioPool();
  if (!pool) return undefined;
  try {
    const result = await pool.query<{ audio_wav: Buffer }>(
      `WITH expired AS (DELETE FROM studio_tts_audio_cache WHERE expires_at <= NOW())
       SELECT audio_wav FROM studio_tts_audio_cache WHERE cache_key = $1 AND model = $2 AND expires_at > NOW() LIMIT 1`,
      [cacheKey, model],
    );
    const audio = result.rows[0]?.audio_wav;
    if (!audio) return undefined;
    await recordTtsCacheHit(model);
    return Buffer.from(audio);
  } catch {
    warnUnavailable();
    return undefined;
  }
}

export async function getCachedTtsKeys(keys: Array<{ cacheKey: string; model: TtsCacheModel }>): Promise<Set<string>> {
  const pool = getStudioPool();
  if (!pool || !keys.length) return new Set();
  try {
    const result = await pool.query<{ cache_key: string }>(
      `WITH expired AS (DELETE FROM studio_tts_audio_cache WHERE expires_at <= NOW())
       SELECT cache_key FROM studio_tts_audio_cache WHERE cache_key = ANY($1::char(64)[]) AND expires_at > NOW()`,
      [keys.map(item => item.cacheKey)],
    );
    return new Set(result.rows.map(row => row.cache_key.trim()));
  } catch {
    warnUnavailable();
    return new Set();
  }
}

export async function saveCachedTtsAudio(value: { cacheKey: string; model: TtsCacheModel; voice: TtsCacheVoice; audio: Buffer }): Promise<boolean> {
  const pool = getStudioPool();
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO studio_tts_audio_cache (cache_key, model, voice, audio_wav, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5::int * INTERVAL '1 day'))
       ON CONFLICT (cache_key) DO UPDATE SET model = EXCLUDED.model, voice = EXCLUDED.voice,
         audio_wav = EXCLUDED.audio_wav, created_at = NOW(), expires_at = EXCLUDED.expires_at`,
      [value.cacheKey, value.model, value.voice, value.audio, TTS_CACHE_TTL_DAYS],
    );
    return true;
  } catch {
    warnUnavailable();
    return false;
  }
}
