import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TTS_SETTINGS, generateSpeech, TTS_MODELS } from "./ttsProvider";

function sampleWav() {
  const wav = Buffer.alloc(256);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

function okResponse(audio = sampleWav()) {
  return { ok: true, status: 200, json: async () => ({ output_audio: { data: audio.toString("base64"), mime_type: "audio/wav" } }) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Gemini TTS adapter", () => {
  it("calls the supported Interactions endpoint and returns valid WAV from the primary model", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSpeech("Olá, Brasil.");

    expect(result.contentType).toBe("audio/wav");
    expect(result.model).toBe(DEFAULT_TTS_SETTINGS.primaryModel);
    expect(result.fallback).toBe(false);
    expect(result.audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(JSON.parse(String(init.body)).model).toBe(TTS_MODELS[0]);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("unit-test-key");
  });

  it("uses the configured fallback after primary failure", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "unused body" } as Response)
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSpeech("Esta é uma frase curta.");

    expect(result.fallback).toBe(true);
    expect(result.model).toBe(DEFAULT_TTS_SETTINGS.fallbackModel);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the key is missing or the output is not a RIFF WAV", async () => {
    await expect(generateSpeech("Olá.")).rejects.toThrow("principal e fallback falharam");

    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const notWav = Buffer.alloc(256, 0x61);
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(notWav)));
    await expect(generateSpeech("Olá.")).rejects.toThrow("WAV válido");
  });

  it("rejects empty or oversized cue before a network request", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateSpeech("  ")).rejects.toThrow("deve ter entre");
    await expect(generateSpeech("a".repeat(2_001))).rejects.toThrow("deve ter entre");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
