import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { testGitHubActionsConnection, validateRenderCallback } from "./renderPipeline";

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

  it("declara os status HTTP usados pelo callback de falha na migration Neon", () => {
    const sql = readFileSync(resolve(process.cwd(), "database/render-callback-status-migration.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS http_status INTEGER/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS upstream_status INTEGER/i);
    expect(sql).toMatch(/http_status IS NULL OR http_status BETWEEN 100 AND 599/i);
    expect(sql).toMatch(/upstream_status IS NULL OR upstream_status BETWEEN 100 AND 599/i);
  });
});

describe("teste somente de leitura da conexão GitHub Actions", () => {
  const token = "unit-test-github-token-never-return-this";
  const endpoint = "https://api.github.com/repos/jadiel054/estudio-canal-ia/releases?per_page=1";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function responseMock(status: number) {
    const body = { json: vi.fn(), text: vi.fn() };
    const response = { status, json: body.json, text: body.text } as unknown as Response;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => response);
    return { fetchMock, body };
  }

  it("confirma acesso real com GET de releases e não retorna credencial, headers ou corpo", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const { fetchMock, body } = responseMock(200);
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: true, status: "ok", httpStatus: 200 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(request?.method).toBe("GET");
    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(request?.body).toBeUndefined();
    expect(body.json).not.toHaveBeenCalled();
    expect(body.text).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result).not.toHaveProperty("headers");
    expect(result).not.toHaveProperty("body");
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [503, "network_error"],
  ] as const)("mapeia HTTP %i para %s sem ler corpo", async (httpStatus, status) => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const { fetchMock, body } = responseMock(httpStatus);
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: false, status, httpStatus });
    expect(body.json).not.toHaveBeenCalled();
    expect(body.text).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("converte falha de rede/timeout em network_error sem expor a exceção", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => { throw new Error(`network failure containing ${token}`); });
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: "network_error", httpStatus: null });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("network failure");
  });

  it("não chama a API e retorna somente estado allowlisted quando o PAT não está configurado", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", "");
    const fetchMock = vi.fn();
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: "unauthorized", httpStatus: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Object.keys(result).sort()).toEqual(["httpStatus", "latencyMs", "ok", "status"]);
  });
});
