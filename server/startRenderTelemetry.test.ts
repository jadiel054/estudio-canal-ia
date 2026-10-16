import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getStudioPool: vi.fn() }));

vi.mock("./studioRepository", async importOriginal => {
  const actual = await importOriginal<typeof import("./studioRepository")>();
  return { ...actual, getStudioPool: mocks.getStudioPool };
});

import { START_RENDER_LOG_STAGES, startRenderPipeline } from "./renderPipeline";

const ideaId = "idea-id-private-for-test";
const scriptId = "script-id-private-for-test";
const privateTitle = "PRIVATE_EDITORIAL_TITLE_NOT_FOR_LOGS";
const privateScript = "PRIVATE_SCRIPT_CONTENT_NOT_FOR_LOGS";
const githubToken = "unit-test-github-token-never-log";
const renderSecret = "unit-test-render-hmac-secret-never-log-1234567890";

function makeState() {
  return {
    version: 1263,
    settings: { voiceMode: "TTS" },
    ideas: [{ id: ideaId, title: privateTitle, format: "Short", status: "assets" }],
    scripts: [{ id: scriptId, ideaId, version: 1, status: "Aprovado", qa: [{ label: "video_stream", passed: true }], content: privateScript }],
    videos: [] as any[],
    renderJobs: [] as any[],
    audit: [] as any[],
  };
}

function setup(options: { lockError?: Error } = {}) {
  const state = makeState();
  const queries: string[] = [];
  const connection = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: null };
      if (sql.includes("SELECT value FROM app_settings") && sql.includes("FOR UPDATE")) {
        if (options.lockError) throw options.lockError;
        return { rows: [{ value: state }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id FROM studio_render_jobs")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("UPDATE studio_render_jobs")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("UPDATE app_settings")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("INSERT INTO")) return { rows: [], rowCount: 1 };
      throw new Error("unexpected SQL in test fixture");
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => connection) };
  mocks.getStudioPool.mockReturnValue(pool);
  return { state, queries, connection, pool };
}

function logRecords(info: ReturnType<typeof vi.spyOn>) {
  return info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

beforeEach(() => {
  mocks.getStudioPool.mockReset();
  vi.stubEnv("GITHUB_ACTIONS_TOKEN", githubToken);
  vi.stubEnv("STUDIO_RENDER_HMAC_SECRET", renderSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("telemetria de studio.startRender", () => {
  it("registra entrada, lock, commit e resposta do dispatch com timestamps e sem dados editoriais", async () => {
    const { state, queries, connection, pool } = setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startRenderPipeline(ideaId);
    const records = logRecords(info);
    const serialized = JSON.stringify(records);
    const stages = records.map(record => record.stage);

    expect(stages).toEqual([
      "entry",
      "neon_connection_wait_started",
      "neon_connection_acquired",
      "transaction_begin_started",
      "transaction_begin_completed",
      "studio_state_lock_wait_started",
      "studio_state_lock_acquired",
      "job_persist_started",
      "job_persist_completed",
      "commit_started",
      "commit_completed",
      "dispatch_started",
      "dispatch_response",
    ]);
    expect(records.every(record => record.event === "studio_start_render_timing")).toBe(true);
    expect(records.every(record => START_RENDER_LOG_STAGES.includes(record.stage as typeof START_RENDER_LOG_STAGES[number]))).toBe(true);
    expect(records.every(record => typeof record.attemptId === "string" && typeof record.timestamp === "string" && Number.isFinite(record.elapsedMs))).toBe(true);
    expect(records.at(-1)).toMatchObject({ outcome: "success", httpStatus: 204 });
    expect(records.find(record => record.stage === "studio_state_lock_acquired")?.durationMs).toEqual(expect.any(Number));
    expect(records.find(record => record.stage === "commit_completed")?.durationMs).toEqual(expect.any(Number));
    for (const privateValue of [ideaId, scriptId, privateTitle, privateScript, githubToken, renderSecret, result.renderJobs[0].id]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(queries).toContain("COMMIT");
  });

  it("deixa breadcrumbs anteriores ao COMMIT quando o SELECT FOR UPDATE falha e não despacha", async () => {
    const lockError = new Error("PRIVATE_DATABASE_ERROR_NOT_FOR_LOGS");
    const { queries, connection } = setup({ lockError });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(startRenderPipeline(ideaId)).rejects.toThrow(lockError);
    const records = logRecords(info);
    const serialized = JSON.stringify(records);
    const stages = records.map(record => record.stage);

    expect(stages).toContain("entry");
    expect(stages).toContain("neon_connection_acquired");
    expect(stages).toContain("studio_state_lock_wait_started");
    expect(stages).toContain("failure");
    expect(stages).not.toContain("studio_state_lock_acquired");
    expect(stages).not.toContain("commit_completed");
    expect(stages).not.toContain("dispatch_started");
    expect(records.find(record => record.stage === "failure")).toMatchObject({ failureStage: "studio_state_lock", failureKind: "database_error" });
    expect(serialized).not.toContain("PRIVATE_DATABASE_ERROR_NOT_FOR_LOGS");
    expect(serialized).not.toContain(githubToken);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queries).toContain("ROLLBACK");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("registra status HTTP rejeitado pelo dispatch sem corpo ou mensagem da API", async () => {
    setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = new Response("PRIVATE_GITHUB_RESPONSE_BODY_NOT_FOR_LOGS", { status: 503 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(startRenderPipeline(ideaId)).rejects.toThrow("HTTP 503");
    const records = logRecords(info);
    const serialized = JSON.stringify(records);
    const responseRecord = records.find(record => record.stage === "dispatch_response");
    const failureRecord = records.find(record => record.stage === "failure");

    expect(responseRecord).toMatchObject({ outcome: "http_error", httpStatus: 503 });
    expect(failureRecord).toMatchObject({ failureStage: "dispatch", failureKind: "dispatch_http_error", httpStatus: 503 });
    expect(serialized).not.toContain("PRIVATE_GITHUB_RESPONSE_BODY_NOT_FOR_LOGS");
    expect(serialized).not.toContain(privateTitle);
    expect(serialized).not.toContain(privateScript);
    expect(serialized).not.toContain(githubToken);
    expect(response.bodyUsed).toBe(false);
  });
});


describe("falha de rede no dispatch de startRender", () => {
  it("registra network_error e não registra a mensagem livre da exceção", async () => {
    setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => { throw new Error("PRIVATE_NETWORK_ERROR_NOT_FOR_LOGS"); });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startRenderPipeline(ideaId)).rejects.toThrow("PRIVATE_NETWORK_ERROR_NOT_FOR_LOGS");
    const records = logRecords(info);
    const serialized = JSON.stringify(records);
    const responseRecord = records.find(record => record.stage === "dispatch_response");
    const failureRecord = records.find(record => record.stage === "failure");

    expect(responseRecord).toMatchObject({ outcome: "network_error" });
    expect(responseRecord).not.toHaveProperty("httpStatus");
    expect(failureRecord).toMatchObject({ failureStage: "dispatch", failureKind: "dispatch_network_error" });
    expect(serialized).not.toContain("PRIVATE_NETWORK_ERROR_NOT_FOR_LOGS");
    expect(serialized).not.toContain(githubToken);
    expect(serialized).not.toContain(privateTitle);
  });
});
