import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TTS_SETTINGS, generateSpeech, generateSpeechCached, testTtsConnection, TTS_MODELS, TtsProviderError } from "./ttsProvider";

const cacheEntries = vi.hoisted(() => new Map<string, Uint8Array>());
const cacheHits = vi.hoisted(() => [] as Array<{ model: string; purpose: string }>);
const usageEvents = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./ttsCache", () => ({
  getCachedTtsAudio: async (key: string, model: string, purpose = "render") => { const audio = cacheEntries.get(key); if (audio) cacheHits.push({ model, purpose }); return audio ? Buffer.from(audio) : undefined; },
  saveCachedTtsAudio: async (entry: { cacheKey: string; audio: Buffer }) => { cacheEntries.set(entry.cacheKey, new Uint8Array(entry.audio)); return true; },
  ttsAudioCacheKey: (value: { text: string; model: string; voice: string; style: string }) => JSON.stringify([value.model, value.voice, value.style, value.text.trim()]),
}));
vi.mock("./ttsUsage", () => ({
  recordTtsApiCall: async (event: Record<string, unknown>) => { usageEvents.push(event); return true; },
}));

function sampleWav(sampleRate = 24_000) {
  const wav = Buffer.alloc(256);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

function responseFromBody(body: unknown, status = 200, headers?: HeadersInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
  } as Response;
}

function okResponse(audio = sampleWav()) {
  return responseFromBody({
    id: "interaction-test",
    steps: [{
      type: "model_output",
      content: [{ type: "audio", mime_type: "audio/wav", data: audio.toString("base64") }],
    }],
  });
}

afterEach(() => {
  vi.useRealTimers();
  cacheEntries.clear();
  cacheHits.length = 0;
  usageEvents.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Gemini TTS adapter", () => {
  it("calls the supported Interactions endpoint and extracts WAV from the raw REST steps", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSpeech("Olá, Brasil.");

    expect(result.contentType).toBe("audio/wav");
    expect(result.model).toBe(DEFAULT_TTS_SETTINGS.primaryModel);
    expect(result.fallback).toBe(false);
    expect(result.audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(result.audio.readUInt32LE(24)).toBe(24_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    expect(body.model).toBe(TTS_MODELS[0]);
    expect(body.response_format).toEqual({ type: "audio", mime_type: "audio/wav", sample_rate: 24_000 });
    expect(body.generation_config.speech_config).toEqual([{ voice: "Kore" }]);
    expect(body.store).toBe(false);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("unit-test-key");
  });

  it("uses the configured fallback after primary failure", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFromBody({ error: { status: "UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(responseFromBody({ error: { status: "UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(responseFromBody({ error: { status: "UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = generateSpeech("Esta é uma frase curta.");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.fallback).toBe(true);
    expect(result.model).toBe(DEFAULT_TTS_SETTINGS.fallbackModel);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("respects structured Retry-After/retryDelay for per-minute quota with bounded backoff", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const minuteLimit = responseFromBody({ error: { status: "RESOURCE_EXHAUSTED", details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/requests_per_minute", quotaId: "tts_rpm", quotaValue: 5 }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "2s" },
    ] } }, 429, { "Retry-After": "1" });
    const fetchMock = vi.fn().mockResolvedValueOnce(minuteLimit).mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = generateSpeech("Uma fala de teste.");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toMatchObject({ fallback: false, model: DEFAULT_TTS_SETTINGS.primaryModel });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops retries on daily quota and surfaces only structured quota metadata", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const dailyLimit = responseFromBody({ error: { status: "RESOURCE_EXHAUSTED", message: "texto privado não persistir", details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/requests_per_day", quotaId: "tts_rpd", quotaValue: 100, description: "daily limit" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "86400s" },
    ] } }, 429);
    const fetchMock = vi.fn(async () => dailyLimit);
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try { await generateSpeech("Uma fala de teste."); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(TtsProviderError);
    expect(caught).toMatchObject({ kind: "quota_daily", quota: { scope: "rpd", value: 100, id: "tts_rpd", retryAfterMs: 86_400_000 } });
    expect(fetchMock).toHaveBeenCalledTimes(2); // uma tentativa no principal e uma no fallback; sem retry de quota diária
    expect(JSON.stringify((caught as TtsProviderError).quota)).not.toContain("texto privado");
  });

  it("reuses cached audio on a resumed chunk instead of calling Gemini again", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const first = await generateSpeechCached("Trecho reutilizável.");
    const resumed = await generateSpeechCached("Trecho reutilizável.");
    expect(first.cached).toBe(false);
    expect(resumed).toMatchObject({ cached: true, model: DEFAULT_TTS_SETTINGS.primaryModel });
    expect(resumed.audio).toEqual(first.audio);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the exact TTS sample on repeat and records both calls as connection_test", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const sampleText = "Olá! Este é um teste de voz em português brasileiro para o Estúdio de Canal IA.";

    const first = await generateSpeechCached(sampleText, DEFAULT_TTS_SETTINGS, undefined, "connection_test");
    const second = await generateSpeechCached(sampleText, DEFAULT_TTS_SETTINGS, undefined, "connection_test");

    expect(first.cached).toBe(false);
    expect(second).toMatchObject({ cached: true, model: DEFAULT_TTS_SETTINGS.primaryModel });
    expect(second.audio).toEqual(first.audio);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usageEvents).toContainEqual(expect.objectContaining({ purpose: "connection_test", outcome: "success" }));
    expect(cacheHits).toEqual([{ model: DEFAULT_TTS_SETTINGS.primaryModel, purpose: "connection_test" }]);
  });

  it("logs only HTTP status and a sanitized structural summary when audio is missing", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    const secretLikeAudio = "A".repeat(240);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => responseFromBody({
      steps: [{ type: "model_output", content: [{ type: "text" }] }],
      metadata: secretLikeAudio,
      prompt: "não deve aparecer no log",
    })));

    await expect(generateSpeech("Olá.")).rejects.toThrow("principal e fallback falharam");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]).toEqual([
      "[Gemini TTS] Resposta sem áudio",
      expect.objectContaining({ status: 200, summary: expect.stringContaining('"steps"') }),
    ]);
    expect(String(warn.mock.calls[0][1])).not.toContain(secretLikeAudio);
    expect(String(warn.mock.calls[0][1])).not.toContain("não deve aparecer no log");
  });

  it("rejects a WAV with a sample rate other than 24 kHz", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(sampleWav(16_000))));

    await expect(generateSpeech("Olá."))
      .rejects.toThrow("principal e fallback falharam");
  });

  it("distinguishes a rejected key from a TTS service that is unavailable", async () => {
    vi.stubEnv("STUDIO_LLM_GEMINI_KEY", "unit-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => responseFromBody({ error: { code: 403, status: "PERMISSION_DENIED", message: "redacted" } }, 403)));

    await expect(testTtsConnection()).resolves.toMatchObject({ ok: false, status: "invalid_key" });

    vi.stubGlobal("fetch", vi.fn(async () => responseFromBody({ steps: [{ type: "model_output", content: [{ type: "text" }] }] })));
    await expect(testTtsConnection()).resolves.toMatchObject({ ok: false, status: "tts_unavailable" });
  });

  it("returns not_configured without a network request when the key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(testTtsConnection()).resolves.toMatchObject({ ok: false, status: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
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
