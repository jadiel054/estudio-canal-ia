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

  function responseMock(status: number, payload?: unknown) {
    const json = vi.fn(async () => payload);
    const text = vi.fn();
    return { response: { status, json, text } as unknown as Response, json, text };
  }

  function sequencedFetch(responses: Array<Response | Error>) {
    let index = 0;
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const next = responses[index++];
      if (next instanceof Error) throw next;
      return next!;
    });
  }

  function expectRequest(fetchMock: ReturnType<typeof sequencedFetch>, index: number, url: string) {
    const [requestUrl, options] = fetchMock.mock.calls[index]!;
    expect(requestUrl).toBe(url);
    expect(options?.method).toBe("GET");
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(options?.body).toBeUndefined();
  }

  it("faz listagem 200 e GET por ID 200 para um draft, sem devolver ID, corpo ou segredo", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const list = responseMock(200, [{ id: 987654, draft: true, name: "não retornar", body: "não retornar", tag_name: "não retornar" }]);
    const byId = responseMock(200, { id: 987654, draft: true, title: "não ler" });
    const fetchMock = sequencedFetch([list.response, byId.response]);
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);

    expect(result).toMatchObject({ listStatus: 200, draftFound: true, getByIdStatus: 200 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectRequest(fetchMock, 0, endpoint);
    expectRequest(fetchMock, 1, `${endpoint.replace("?per_page=1", "/987654")}`);
    expect(list.json).toHaveBeenCalledTimes(1);
    expect(list.text).not.toHaveBeenCalled();
    expect(byId.json).not.toHaveBeenCalled();
    expect(byId.text).not.toHaveBeenCalled();
    for (const secretOrBody of [token, "não retornar", "não ler", "987654"]) expect(JSON.stringify(result)).not.toContain(secretOrBody);
    expect(Object.keys(result).sort()).toEqual(["draftFound", "getByIdStatus", "latencyMs", "listStatus"]);
  });

  it("distingue listagem 200 e GET por ID 404 para um draft listado", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const list = responseMock(200, [{ id: 43, draft: true, title: "privado" }]);
    const byId = responseMock(404, { message: "não ler nem devolver" });
    const fetchMock = sequencedFetch([list.response, byId.response]);
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ listStatus: 200, draftFound: true, getByIdStatus: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectRequest(fetchMock, 1, `${endpoint.replace("?per_page=1", "/43")}`);
    expect(byId.json).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("privado");
  });

  it("não faz GET por ID quando a listagem 200 não tem draft", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const list = responseMock(200, [{ id: 12, draft: false, title: "não retornar", body: "não retornar" }]);
    const fetchMock = sequencedFetch([list.response]);
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ listStatus: 200, draftFound: false, getByIdStatus: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(list.json).toHaveBeenCalledTimes(1);
    expect(list.text).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("não retornar");
  });

  it.each([401, 403, 404, 503])("preserva status HTTP %i da listagem e não tenta ler corpo nem buscar ID", async listStatus => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const list = responseMock(listStatus, { secret: "não retornar" });
    const fetchMock = sequencedFetch([list.response]);
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ listStatus, draftFound: false, getByIdStatus: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(list.json).not.toHaveBeenCalled();
    expect(list.text).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("não retornar");
  });

  it("mantém getByIdStatus null em falha de rede após encontrar draft", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", token);
    const list = responseMock(200, [{ id: 91, draft: true }]);
    const fetchMock = sequencedFetch([list.response, new Error(`network failure ${token}`)]);
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ listStatus: 200, draftFound: true, getByIdStatus: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("retorna status null sem chamar API quando o PAT está ausente", async () => {
    vi.stubEnv("GITHUB_ACTIONS_TOKEN", "");
    const fetchMock = vi.fn();
    const result = await testGitHubActionsConnection(fetchMock as typeof fetch);
    expect(result).toMatchObject({ listStatus: null, draftFound: false, getByIdStatus: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
