import { describe, expect, it } from "vitest";
import { ttsAudioCacheKey } from "./ttsCache";

const base = { text: "Olá, mundo.", model: "gemini-3.8-flash-tts" as const, voice: "Kore" as const, style: "PT-BR natural" };

describe("TTS audio cache key", () => {
  it("is deterministic and does not contain the narration text", () => {
    const key = ttsAudioCacheKey(base);
    expect(key).toBe(ttsAudioCacheKey({ ...base }));
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain(base.text);
  });

  it("separates entries by exact text, model, voice, and style", () => {
    const key = ttsAudioCacheKey(base);
    expect(ttsAudioCacheKey({ ...base, text: "Olá, outra pessoa." })).not.toBe(key);
    expect(ttsAudioCacheKey({ ...base, model: "gemini-3.8-flash-lite-tts" })).not.toBe(key);
    expect(ttsAudioCacheKey({ ...base, voice: "Aoede" })).not.toBe(key);
    expect(ttsAudioCacheKey({ ...base, style: "PT-BR pausado" })).not.toBe(key);
  });
});
