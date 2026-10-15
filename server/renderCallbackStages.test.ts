import { describe, expect, it, vi } from "vitest";
import { processRenderCallback, verifyOutputRelease, type RenderCallback } from "./renderPipeline";
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

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function queuedFetch(...steps: Array<Response | Error>): typeof fetch {
  let index = 0;
  return vi.fn(async () => {
    const step = steps[index++];
    if (step instanceof Error) throw step;
    return step as Response;
  }) as unknown as typeof fetch;
}

function verifyReleaseWith(fetcher: typeof fetch) {
  return processRenderCallback(qaCallback, {
    verifyRelease: callbackValue => verifyOutputRelease(callbackValue, fetcher, "token-de-teste"),
  });
}

const releaseOk = jsonResponse({ id: 4, draft: true });
const assetOk = { id: 8, name: `estudio-${jobId}.mp4`, size: 220_000, state: "uploaded", content_type: "video/mp4" };
const invalidJson = { ok: true, json: async () => { throw new Error("resposta privada"); } } as Response;
const releaseVerificationCases: Array<[string, Array<Response | Error>, RenderCallbackStageCode]> = [
  ["falha de rede ao consultar o Release", [new Error("token privado")], "verificacao_release_consulta"],
  ["resposta HTTP do Release rejeitada", [jsonResponse({}, false)], "verificacao_release_consulta"],
  ["corpo do Release ilegível", [invalidJson], "verificacao_release_resposta"],
  ["Release não é o draft esperado", [jsonResponse({ id: 5, draft: false })], "verificacao_release_estado"],
  ["falha de rede ao consultar assets", [releaseOk, new Error("token privado")], "verificacao_assets_consulta"],
  ["resposta HTTP dos assets rejeitada", [releaseOk, jsonResponse([], false)], "verificacao_assets_consulta"],
  ["corpo dos assets ilegível", [releaseOk, invalidJson], "verificacao_assets_resposta"],
  ["corpo dos assets não é uma lista", [releaseOk, jsonResponse({})], "verificacao_assets_resposta"],
  ["asset não encontrado", [releaseOk, jsonResponse([])], "verificacao_asset_ausente"],
  ["asset ainda não enviado", [releaseOk, jsonResponse([{ ...assetOk, state: "new" }])], "verificacao_asset_estado"],
  ["nome do asset divergente", [releaseOk, jsonResponse([{ ...assetOk, name: "outro.mp4" }])], "verificacao_asset_nome"],
  ["tamanho do asset divergente", [releaseOk, jsonResponse([{ ...assetOk, size: 1 }])], "verificacao_asset_tamanho"],
  ["tipo do asset não permitido", [releaseOk, jsonResponse([{ ...assetOk, content_type: "text/plain" }])], "verificacao_asset_tipo"],
];

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

  it.each(releaseVerificationCases)("identifica o ramo da verificação do Release: %s", async (_caseName, steps, stageCode) => {
    await expectStage(verifyReleaseWith(queuedFetch(...steps)), stageCode, "callback_release_verification_failed");
  });

  it("classifica metadados incompletos sem fazer consulta externa", async () => {
    const fetcher = vi.fn();
    await expectStage(
      verifyOutputRelease({ ...qaCallback, fileName: undefined } as unknown as RenderCallback, fetcher as unknown as typeof fetch, "token-de-teste"),
      "verificacao_release_metadados",
      "callback_release_verification_failed",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aceita somente draft e metadados do asset que correspondem ao callback", async () => {
    const fetcher = queuedFetch(
      jsonResponse({ id: 4, draft: true }),
      jsonResponse([{ id: 8, name: `estudio-${jobId}.mp4`, size: 220_000, state: "uploaded", content_type: "video/mp4" }]),
    );
    await expect(verifyOutputRelease(qaCallback as unknown as RenderCallback, fetcher, "token-de-teste")).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
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
    const releaseRecord = renderFailureLogRecord(callbackStageDiagnostic("verificacao_asset_nome"), 400);
    expect(releaseRecord).toEqual({ event: "falha_operacao_render", operation: "callback", errorCode: "callback_release_verification_failed", httpStatus: 400, stageCode: "verificacao_asset_nome" });
    expect(JSON.stringify(releaseRecord)).not.toContain("token privado");
  });
});
