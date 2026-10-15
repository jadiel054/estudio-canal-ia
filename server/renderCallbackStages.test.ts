import { describe, expect, it, vi } from "vitest";
import { processRenderCallback } from "./renderPipeline";
import {
  callbackStageDiagnostic,
  classifyRenderFailure,
  RenderCallbackStageError,
  renderFailureLogRecord,
  type RenderCallbackStageCode,
} from "./renderObservability";

const jobId = "123e4567-e89b-42d3-a456-426614174000";
const eventId = "123e4567-e89b-42d3-a456-426614174001";
const anotherJobId = "123e4567-e89b-42d3-a456-426614174099";
const workflowRunId = 77;
const callback = { eventId, jobId, workflowRunId, status: "rendering", progress: 55 };
const qaCallback = {
  eventId, jobId, workflowRunId, status: "qa", progress: 95,
  releaseId: 4, assetId: 8, fileName: `estudio-${jobId}.mp4`, fileSizeBytes: 220_000, durationSeconds: 23.4,
  qa: ["video_stream", "audio_stream", "captions", "duration", "file_size"].map(label => ({ label, passed: true, verified: true, note: "verificado" })),
};

function stateForCallback(scriptStatus = "Aprovado", scriptVersion = 1) {
  return {
    version: 4,
    videos: [{ id: "video-1", ideaId: "idea-1", stage: "render" }],
    ideas: [{ id: "idea-1", title: "Pauta de teste", status: "render" }],
    scripts: [{ id: "script-1", ideaId: "idea-1", status: scriptStatus, version: scriptVersion, qa: { passed: true } }],
    renderJobs: [{ id: jobId, videoId: "video-1", status: "rendering", progress: 55 }],
    audit: [],
  };
}

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId, video_id: "video-1", idea_id: "idea-1", script_id: "script-1", script_version: 1,
    status: "rendering", workflow_run_id: String(workflowRunId), ...overrides,
  };
}

type HarnessOptions = {
  job?: Record<string, unknown> | null;
  state?: Record<string, unknown> | null;
  eventRowCount?: number;
  existingEvent?: { job_id: string; status: string } | null;
  failIdempotency?: boolean;
  failUpdate?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const job = options.job === undefined ? baseJob() : options.job;
  const state = options.state === undefined ? stateForCallback() : options.state;
  const query = vi.fn(async (sql: string) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 1 };
    if (sql.startsWith("SELECT id, video_id, idea_id, script_id")) return { rows: job ? [job] : [], rowCount: job ? 1 : 0 };
    if (sql.startsWith("INSERT INTO studio_render_callback_events")) {
      if (options.failIdempotency) throw new Error("conteúdo privado: não registrar");
      return { rows: [], rowCount: options.eventRowCount ?? 1 };
    }
    if (sql.startsWith("SELECT job_id::text, status FROM studio_render_callback_events")) {
      return { rows: options.existingEvent ? [options.existingEvent] : [], rowCount: options.existingEvent ? 1 : 0 };
    }
    if (sql.startsWith("SELECT value FROM app_settings")) return { rows: state ? [{ value: state }] : [], rowCount: state ? 1 : 0 };
    if (sql.startsWith("UPDATE studio_render_jobs")) {
      if (options.failUpdate) throw new Error("valor SQL privado: não registrar");
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE app_settings")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const connection = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => connection) } as any;
  return { pool, query, connection };
}

async function expectStage(promise: Promise<unknown>, stageCode: RenderCallbackStageCode, errorCode: string) {
  await expect(promise).rejects.toMatchObject({ name: "RenderCallbackStageError", stageCode, errorCode });
}

describe("etapas seguras do callback de render", () => {
  it("classifica payload inválido sem preservar mensagem, corpo ou segredo", async () => {
    await expectStage(processRenderCallback({ message: "roteiro privado" }), "validacao_payload", "callback_payload_invalid");
    const failure = new RenderCallbackStageError("validacao_payload");
    expect(failure.message).toBe("callback_payload_invalid");
    expect(failure.message).not.toContain("roteiro privado");
  });

  it("recusa falha na verificação do Release apenas como etapa allowlisted", async () => {
    await expectStage(
      processRenderCallback(qaCallback, {
        verifyRelease: async () => { throw new Error("asset privado ou token: não registrar"); },
      }),
      "verificacao_release",
      "callback_release_verification_failed",
    );
  });

  it("classifica falhas de verificação de idempotência sem expor erro SQL", async () => {
    const harness = createHarness({ failIdempotency: true });
    await expectStage(processRenderCallback(callback, { pool: harness.pool }), "idempotencia", "callback_idempotency_failed");
  });

  it("rejeita reutilização do mesmo eventId para outro job/status", async () => {
    const harness = createHarness({ eventRowCount: 0, existingEvent: { job_id: anotherJobId, status: "rendering" } });
    await expectStage(processRenderCallback(callback, { pool: harness.pool }), "idempotencia", "callback_idempotency_failed");
  });

  it("ignora duplicata idêntica de forma idempotente e registra apenas a etapa", async () => {
    const harness = createHarness({ eventRowCount: 0, existingEvent: { job_id: jobId, status: "rendering" } });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await expect(processRenderCallback(callback, { pool: harness.pool })).resolves.toMatchObject({ duplicate: true, jobId });
      expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({ event: "callback_duplicado_ignorado", operation: "callback", stageCode: "idempotencia" });
    } finally { info.mockRestore(); }
  });

  it.each([
    ["job ausente", { job: null }],
    ["workflow divergente", { job: baseJob({ workflow_run_id: "78" }) }],
    ["job já concluído", { job: baseJob({ status: "succeeded" }) }],
    ["estado do estúdio ausente", { state: null }],
    ["roteiro sem Portão 1", { state: stateForCallback("Em revisão") }],
    ["versão do roteiro divergente", { state: stateForCallback("Aprovado", 2) }],
    ["job falhado recebendo progresso", { job: baseJob({ status: "failed" }) }],
  ] as Array<[string, HarnessOptions]>)
  ("classifica rejeição de estado do job: %s", async (_caseName, options) => {
    const harness = createHarness(options);
    await expectStage(processRenderCallback(callback, { pool: harness.pool }), "estado_job", "callback_job_state_rejected");
  });

  it("classifica falha de UPDATE/commit sem persistir mensagem do banco", async () => {
    const harness = createHarness({ failUpdate: true });
    await expectStage(processRenderCallback(callback, { pool: harness.pool }), "update_banco", "callback_database_update_failed");
  });

  it("constrói log estruturado com apenas nome da etapa e enumeração segura", () => {
    const diagnostic = callbackStageDiagnostic("update_banco");
    const record = renderFailureLogRecord(diagnostic, 400);
    expect(record).toEqual({ event: "falha_operacao_render", operation: "callback", errorCode: "callback_database_update_failed", httpStatus: 400, stageCode: "update_banco" });
    expect(JSON.stringify(record)).not.toContain("conteúdo editorial");
    expect(classifyRenderFailure("callback", new RenderCallbackStageError("update_banco"))).toMatchObject(diagnostic);
  });
});
