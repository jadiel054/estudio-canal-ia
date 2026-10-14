import { describe, expect, it } from "vitest";
import { validateRenderCallback } from "./renderPipeline";

const jobId = "123e4567-e89b-42d3-a456-426614174000";
const eventId = "123e4567-e89b-42d3-a456-426614174001";
const labels = ["video_stream", "audio_stream", "captions", "duration", "file_size"];
const base = {
  eventId, jobId, workflowRunId: 77, status: "qa", progress: 95,
  releaseId: 4, assetId: 8, fileName: `estudio-${jobId}.mp4`, fileSizeBytes: 220_000,
  durationSeconds: 23.417,
  qa: labels.map(label => ({ label, passed: true, verified: true, note: "Verificação local" })),
};

describe("callback do render real", () => {
  it("aceita duração decimal e checks verificáveis completos", () => {
    const callback = validateRenderCallback(base);
    expect(callback.durationSeconds).toBe(23.417);
    expect(callback.qa).toHaveLength(5);
  });

  it("rejeita checks não verificados ou ausentes", () => {
    const unverified = structuredClone(base);
    unverified.qa[0] = { label: "video_stream", passed: true, verified: false, note: "não verificado" };
    expect(() => validateRenderCallback(unverified)).toThrow("não verificado");
    const missing = { ...base, qa: base.qa.filter(item => item.label !== "captions") };
    expect(() => validateRenderCallback(missing)).toThrow("checks verificáveis");
  });

  it("rejeita tamanhos excessivos e nomes de arquivo inseguros", () => {
    expect(() => validateRenderCallback({ ...base, fileName: "../../video.mp4" })).toThrow("Nome de MP4");
    expect(() => validateRenderCallback({ ...base, fileSizeBytes: 2_000_000_001 })).toThrow("limites permitidos");
  });

  it("aceita operação, código e status numéricos em falha e não usa a mensagem livre como diagnóstico", () => {
    const failed = validateRenderCallback({
      eventId, jobId, workflowRunId: 77, status: "failed", progress: 90,
      errorOperation: "voice", errorCode: "tts_timeout", httpStatus: 400, upstreamStatus: 429,
      message: "conteúdo editorial secreto não deve ser exibido",
    });
    expect(failed).toMatchObject({
      errorOperation: "voice", errorCode: "tts_timeout", httpStatus: 400, upstreamStatus: 429,
    });
  });

  it("rejeita códigos livres, operações desconhecidas e status fora do intervalo", () => {
    const failed = { eventId, jobId, workflowRunId: 77, status: "failed", progress: 90 };
    expect(() => validateRenderCallback({ ...failed, errorCode: "texto secreto" })).toThrow("Código de diagnóstico");
    expect(() => validateRenderCallback({ ...failed, errorOperation: "token-secreto" })).toThrow("Operação de diagnóstico");
    expect(() => validateRenderCallback({ ...failed, httpStatus: 99 })).toThrow("Status HTTP");
    expect(() => validateRenderCallback({ ...base, errorCode: "tts_timeout" })).toThrow("só é permitido");
  });

  it("aceita somente metadados estruturados e limitados de quota", () => {
    const failed = validateRenderCallback({
      eventId, jobId, workflowRunId: 77, status: "failed", progress: 90,
      errorOperation: "voice", errorCode: "tts_quota_daily", httpStatus: 400, upstreamStatus: 429,
      quotaScope: "rpd", quotaValue: 25, quotaMetric: "generativelanguage.googleapis.com/requests_per_day",
      quotaId: "tts_requests", retryAfterMs: 86_400_000, providerModel: "gemini-3.8-flash-tts",
    });
    expect(failed).toMatchObject({ quotaScope: "rpd", quotaValue: 25, quotaMetric: "generativelanguage.googleapis.com/requests_per_day", retryAfterMs: 86_400_000, providerModel: "gemini-3.8-flash-tts" });
    expect(() => validateRenderCallback({ ...failed, quotaMetric: "quota label: roteiro confidencial" })).toThrow("Identificador de quota");
    expect(() => validateRenderCallback({ ...failed, retryAfterMs: -1 })).toThrow("Retry-After");
    expect(() => validateRenderCallback({ ...failed, providerModel: "segredo" })).toThrow("Modelo TTS");
  });
});
