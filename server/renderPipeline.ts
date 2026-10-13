import { createHash, randomUUID } from "node:crypto";
import { canStartRender } from "@shared/workflowPolicy";
import { RENDER_PATHS, signRenderRequest } from "./renderSecurity";
import { extractScriptVisuals } from "./renderManifest";
import { getStudioPool, stateVersion } from "./studioRepository";
import { generateSpeech, getTtsSettings } from "./ttsProvider";
import { isRenderErrorCode, isRenderOperation, renderFailureSummary, type RenderErrorCode, type RenderOperation } from "./renderObservability";

const OWNER = "jadiel054";
const REPOSITORY = "estudio-canal-ia";
const WORKFLOW_FILE = "video-render.yml";
const CLEANUP_WORKFLOW_FILE = "render-cleanup.yml";
const JOB_ACTIVE = ["queued", "rendering", "qa"] as const;
const REQUIRED_QA_LABELS = ["video_stream", "audio_stream", "captions", "duration", "file_size"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredRenderSecret() {
  const value = process.env.STUDIO_RENDER_HMAC_SECRET;
  if (!value || value.length < 32) throw new Error("Configure STUDIO_RENDER_HMAC_SECRET (mínimo 32 caracteres) no Vercel e em Actions Secrets.");
  return value;
}
function requiredActionsToken() {
  const value = process.env.GITHUB_ACTIONS_TOKEN;
  if (!value) throw new Error("Configure GITHUB_ACTIONS_TOKEN no Vercel com acesso Actions: write e Contents: read somente a este repositório.");
  return value;
}
function requirePool() {
  const pool = getStudioPool();
  if (!pool) throw new Error("Neon não configurado para jobs reais de render.");
  return pool;
}

export function renderIntegrationStatus() {
  const neon = Boolean(process.env.STUDIO_DATABASE_URL);
  const githubToken = Boolean(process.env.GITHUB_ACTIONS_TOKEN);
  const hmacSecret = Boolean(process.env.STUDIO_RENDER_HMAC_SECRET);
  const geminiTts = Boolean(process.env.STUDIO_LLM_GEMINI_KEY);
  return { configured: neon && githubToken && hmacSecret, neon, githubToken, hmacSecret, geminiTts };
}

export async function startRenderPipeline(ideaId: string) {
  requiredActionsToken(); requiredRenderSecret();
  const pool = requirePool(); const connection = await pool.connect();
  let jobId = ""; let stateToReturn: any;
  try {
    await connection.query("BEGIN");
    const result = await connection.query<{ value: any }>("SELECT value FROM app_settings WHERE key = 'studio_state' FOR UPDATE");
    const state = result.rows[0]?.value;
    if (!state) throw new Error("Importe o estado do estúdio para o Neon antes de iniciar um render real.");
    if (!["TTS", "Música + texto"].includes(state.settings?.voiceMode)) throw new Error("O modo 'Sua voz' ainda não está habilitado. Selecione TTS ou Música + texto em Configurações.");
    const idea = state.ideas?.find((item: any) => item.id === ideaId && !item.example);
    const script = state.scripts?.find((item: any) => item.ideaId === ideaId && !item.example);
    if (!idea || !script) throw new Error("Pauta real ou roteiro não encontrado; itens de demonstração não podem iniciar produção.");
    const gate = canStartRender(idea.status, script.status);
    if (!gate.allowed || script.status !== "Aprovado" || !script.qa) throw new Error(gate.allowed ? "O roteiro precisa ter QA persistido e aprovação do Portão 1." : gate.reason);
    const active = await connection.query("SELECT id FROM studio_render_jobs WHERE script_id = $1 AND script_version = $2 AND status = ANY($3::text[]) LIMIT 1 FOR UPDATE", [script.id, script.version, [...JOB_ACTIVE]]);
    if (active.rowCount) throw new Error("Já existe um job ativo para esta versão aprovada do roteiro.");

    const now = new Date().toISOString(); const videoId = randomUUID(); jobId = randomUUID();
    const video = { id: videoId, ideaId: idea.id, scriptId: script.id, title: idea.title, format: idea.format, stage: "render", duration: "A calcular", synthetic: false, simulated: false, renderJobId: jobId, qa: [] };
    state.videos = [video, ...(state.videos ?? []).filter((item: any) => item.ideaId !== ideaId || item.example)];
    idea.status = "render";
    const renderJob = { id: jobId, videoId, status: "queued", attempts: 1, progress: 0, startedAt: now, simulated: false };
    state.renderJobs = [renderJob, ...(state.renderJobs ?? []).filter((item: any) => item.videoId !== videoId)];
    state.audit = [{ id: randomUUID(), actor: "Você", action: "Render real solicitado", target: idea.title, at: now, detail: `Roteiro v${script.version} aprovado; aguardando GitHub Actions` }, ...(state.audit ?? [])].slice(0, 500);
    const oldVersion = stateVersion(state); state.version = oldVersion + 1;
    await connection.query("INSERT INTO studio_render_jobs (id, video_id, idea_id, script_id, script_version, status, attempts, progress, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4, $5, 'queued', 1, 0, NOW(), NOW())", [jobId, videoId, ideaId, script.id, script.version]);
    const saved = await connection.query("UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'studio_state' AND COALESCE((value->>'version')::int, 0) = $2", [JSON.stringify(state), oldVersion]);
    if (saved.rowCount !== 1) throw new Error("O estado mudou durante a criação do job; atualize e tente novamente.");
    await connection.query("INSERT INTO audit_log (actor, action, target, details) VALUES ('Você', 'Render real solicitado', $1, $2::jsonb)", [idea.title, JSON.stringify({ jobId, scriptId: script.id, scriptVersion: script.version })]);
    await connection.query("COMMIT"); stateToReturn = state;
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }

  try { await dispatchRenderWorkflow(jobId); }
  catch (error) { await markRenderDispatchFailure(jobId, error instanceof Error ? error.message : "Falha ao despachar o workflow."); throw error; }
  return stateToReturn;
}

async function dispatchRenderWorkflow(jobId: string) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${requiredActionsToken()}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { jobId } }), signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 204) throw new Error(`GitHub Actions recusou o dispatch (HTTP ${response.status}). Verifique Actions: write no PAT e se ${WORKFLOW_FILE} está na branch main.`);
}

async function markRenderDispatchFailure(jobId: string, message: string) {
  const connection = await requirePool().connect();
  try {
    await connection.query("BEGIN");
    await connection.query("UPDATE studio_render_jobs SET status = 'failed', error_code = 'dispatch_failed', error_message = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1::uuid AND status = 'queued'", [jobId, message.slice(0, 400)]);
    const result = await connection.query<{ value: any }>("SELECT value FROM app_settings WHERE key = 'studio_state' FOR UPDATE");
    const state = result.rows[0]?.value;
    if (state) {
      const job = state.renderJobs?.find((item: any) => item.id === jobId); const video = state.videos?.find((item: any) => item.id === job?.videoId); const idea = video && state.ideas?.find((item: any) => item.id === video.ideaId);
      if (job) { job.status = "failed"; job.error = message.slice(0, 400); job.errorCode = "dispatch_failed"; job.finishedAt = new Date().toISOString(); }
      if (video) video.stage = "erro"; if (idea) idea.status = "erro";
      const oldVersion = stateVersion(state); state.version = oldVersion + 1;
      await connection.query("UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'studio_state' AND COALESCE((value->>'version')::int, 0) = $2", [JSON.stringify(state), oldVersion]);
    }
    await connection.query("COMMIT");
  } catch { await connection.query("ROLLBACK"); }
  finally { connection.release(); }
}

export type RenderManifest = {
  jobId: string; videoId: string; scriptId: string; scriptVersion: number; title: string;
  format: "Longo" | "Short" | "Live"; cues: ReturnType<typeof extractScriptVisuals>["cues"];
  codeBlocks: string[]; sections: string[]; references: string[]; voiceMode: "TTS" | "Música + texto";
  inputs: Array<{ id: string; fileName: string; contentType: string; sizeBytes: number; sha256: string; label: string }>;
  tts: { primaryModel: string; fallbackModel: string; voice: string };
};

export async function getSignedRenderManifest(jobId: string) {
  if (!UUID_PATTERN.test(jobId)) throw new Error("Job de render inválido.");
  requiredRenderSecret(); const pool = requirePool();
  const jobResult = await pool.query<{ id: string; video_id: string; idea_id: string; script_id: string; script_version: number; status: string }>("SELECT id, video_id, idea_id, script_id, script_version, status FROM studio_render_jobs WHERE id = $1::uuid LIMIT 1", [jobId]);
  const job = jobResult.rows[0];
  if (!job || !JOB_ACTIVE.includes(job.status as typeof JOB_ACTIVE[number])) throw new Error("Job inexistente ou não ativo.");
  const stateResult = await pool.query<{ value: any }>("SELECT value FROM app_settings WHERE key = 'studio_state' LIMIT 1");
  const state = stateResult.rows[0]?.value; const script = state?.scripts?.find((item: any) => item.id === job.script_id && !item.example); const idea = state?.ideas?.find((item: any) => item.id === job.idea_id && !item.example);
  if (!script || !idea || script.status !== "Aprovado" || script.version !== job.script_version || !script.qa) throw new Error("A aprovação do Portão 1 ou a versão do roteiro mudou; o manifesto foi bloqueado.");
  const visuals = extractScriptVisuals(script.content); const tts = await getTtsSettings();
  const inputResult = await pool.query<{ id: string; file_name: string; content_type: string; file_size_bytes: number; sha256: string }>("SELECT id::text, file_name, content_type, file_size_bytes, sha256 FROM studio_render_inputs WHERE script_id = $1 AND script_version = $2 ORDER BY created_at ASC LIMIT 5", [script.id, script.version]);
  const manifest: RenderManifest = {
    jobId: job.id, videoId: job.video_id, scriptId: job.script_id, scriptVersion: job.script_version,
    title: idea.title, format: idea.format, cues: visuals.cues, codeBlocks: visuals.codeBlocks, sections: visuals.sections,
    references: (idea.captureUrls ?? []).filter((url: unknown): url is string => typeof url === "string" && /^https:\/\//i.test(url)).slice(0, 10),
    voiceMode: state.settings?.voiceMode === "Música + texto" ? "Música + texto" : "TTS",
    inputs: inputResult.rows.map(input => ({ id: input.id, fileName: input.file_name, contentType: input.content_type, sizeBytes: Number(input.file_size_bytes), sha256: input.sha256, label: input.file_name })),
    tts: { primaryModel: tts.primaryModel, fallbackModel: tts.fallbackModel, voice: tts.voice },
  };
  const body = JSON.stringify(manifest); const hash = createHash("sha256").update(body).digest("hex");
  const previous = await pool.query<{ manifest_sha256: string }>("SELECT manifest_sha256 FROM studio_render_manifest_hashes WHERE job_id = $1::uuid", [jobId]);
  if (previous.rows[0] && previous.rows[0].manifest_sha256 !== hash) throw new Error("O manifesto diverge do hash imutável do job.");
  await pool.query("INSERT INTO studio_render_manifest_hashes (job_id, manifest_sha256) VALUES ($1::uuid, $2) ON CONFLICT (job_id) DO NOTHING", [jobId, hash]);
  return { body, signature: signRenderRequest(body, requiredRenderSecret(), { method: "POST", path: RENDER_PATHS.manifest }), manifest };
}

export async function getSignedRenderInput(jobId: string, inputAssetId: string) {
  if (!UUID_PATTERN.test(jobId) || !UUID_PATTERN.test(inputAssetId)) throw new Error("IDs de captura inválidos.");
  const pool = requirePool();
  const result = await pool.query<{ data: Buffer; file_name: string; content_type: string; sha256: string }>(`SELECT i.data, i.file_name, i.content_type, i.sha256
    FROM studio_render_jobs j JOIN studio_render_inputs i ON i.script_id = j.script_id AND i.script_version = j.script_version
    WHERE j.id = $1::uuid AND i.id = $2::uuid AND j.status = ANY($3::text[]) LIMIT 1`, [jobId, inputAssetId, [...JOB_ACTIVE]]);
  const input = result.rows[0]; if (!input) throw new Error("Captura não pertence à versão aprovada deste job.");
  return { data: input.data, fileName: input.file_name, contentType: input.content_type, sha256: input.sha256, signature: signRenderRequest(input.data, requiredRenderSecret(), { method: "POST", path: RENDER_PATHS.input }) };
}

export async function synthesizeRenderCue(jobId: string, cueIndex: number) {
  if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex >= 80) throw new Error("Índice de legenda fora dos limites.");
  const { manifest } = await getSignedRenderManifest(jobId); if (manifest.voiceMode !== "TTS") throw new Error("Este job usa música e texto; não há cue TTS.");
  const cue = manifest.cues[cueIndex]; if (!cue || cue.index !== cueIndex) throw new Error("Trecho de narração inexistente no manifesto aprovado.");
  const speech = await generateSpeech(cue.text, await getTtsSettings());
  return { audio: speech.audio, signature: signRenderRequest(speech.audio, requiredRenderSecret(), { method: "POST", path: RENDER_PATHS.voice }), model: speech.model, voice: speech.voice, fallback: speech.fallback };
}

export type RenderQaCheck = { label: string; passed: boolean; verified: true; note: string };
export type RenderCallback = {
  eventId: string; jobId: string; workflowRunId: number; status: "rendering" | "qa" | "failed"; progress: number;
  message?: string; releaseId?: number; assetId?: number; fileName?: string; fileSizeBytes?: number; durationSeconds?: number; qa?: RenderQaCheck[];
  errorOperation?: RenderOperation; errorCode?: RenderErrorCode; httpStatus?: number; upstreamStatus?: number;
};

export function validateRenderCallback(input: unknown): RenderCallback {
  if (!input || typeof input !== "object") throw new Error("Callback de render inválido.");
  const value = input as Record<string, unknown>;
  if (typeof value.eventId !== "string" || !UUID_PATTERN.test(value.eventId) || typeof value.jobId !== "string" || !UUID_PATTERN.test(value.jobId)) throw new Error("Identificador do evento ou job inválido.");
  if (!Number.isSafeInteger(value.workflowRunId) || Number(value.workflowRunId) < 1) throw new Error("Identificador de workflow inválido.");
  if (!(value.status === "rendering" || value.status === "qa" || value.status === "failed")) throw new Error("Status de callback não permitido.");
  if (!Number.isInteger(value.progress) || Number(value.progress) < 0 || Number(value.progress) > 100) throw new Error("Progresso fora do intervalo aceito.");
  const callback: RenderCallback = { eventId: value.eventId, jobId: value.jobId, workflowRunId: Number(value.workflowRunId), status: value.status, progress: Number(value.progress), ...(typeof value.message === "string" ? { message: value.message.slice(0, 400) } : {}) };
  const hasDiagnostics = value.errorOperation !== undefined || value.errorCode !== undefined || value.httpStatus !== undefined || value.upstreamStatus !== undefined;
  if (value.status === "failed") {
    if (value.errorOperation !== undefined && !isRenderOperation(value.errorOperation)) throw new Error("Operação de diagnóstico inválida.");
    if (value.errorCode !== undefined && !isRenderErrorCode(value.errorCode)) throw new Error("Código de diagnóstico inválido.");
    for (const key of ["httpStatus", "upstreamStatus"] as const) {
      if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < 100 || Number(value[key]) > 599)) throw new Error("Status HTTP de diagnóstico inválido.");
    }
    callback.errorOperation = isRenderOperation(value.errorOperation) ? value.errorOperation : "worker";
    callback.errorCode = isRenderErrorCode(value.errorCode) ? value.errorCode : "render_failed";
    if (value.httpStatus !== undefined) callback.httpStatus = Number(value.httpStatus);
    if (value.upstreamStatus !== undefined) callback.upstreamStatus = Number(value.upstreamStatus);
  } else if (hasDiagnostics) {
    throw new Error("Diagnóstico só é permitido em callbacks de falha.");
  }
  if (value.status === "qa") {
    for (const key of ["releaseId", "assetId", "fileSizeBytes"]) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) throw new Error(`Campo ${key} ausente ou inválido no callback de QA.`);
    if (typeof value.durationSeconds !== "number" || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0) throw new Error("Campo durationSeconds ausente ou inválido no callback de QA.");
    if (typeof value.fileName !== "string" || !/^[a-zA-Z0-9._-]{1,180}\.mp4$/.test(value.fileName)) throw new Error("Nome de MP4 inválido.");
    if (!Array.isArray(value.qa) || value.qa.length < REQUIRED_QA_LABELS.length || value.qa.length > 20) throw new Error("O callback não trouxe todos os checks verificáveis de QA.");
    const labels = new Set<string>();
    callback.qa = value.qa.map((item: any) => {
      if (!item || typeof item.label !== "string" || typeof item.passed !== "boolean" || item.verified !== true || typeof item.note !== "string") throw new Error("Check de QA inválido ou não verificado.");
      labels.add(item.label); return { label: item.label.slice(0, 160), passed: item.passed, verified: true, note: item.note.slice(0, 500) };
    });
    if (REQUIRED_QA_LABELS.some(label => !labels.has(label))) throw new Error("Faltam verificações obrigatórias de áudio, vídeo, legendas, duração ou tamanho.");
    callback.releaseId = Number(value.releaseId); callback.assetId = Number(value.assetId); callback.fileSizeBytes = Number(value.fileSizeBytes); callback.durationSeconds = Number(value.durationSeconds); callback.fileName = value.fileName;
    if (callback.releaseId < 1 || callback.assetId < 1 || callback.fileSizeBytes < 1 || callback.fileSizeBytes > 2_000_000_000 || callback.durationSeconds <= 0 || callback.durationSeconds > 7_200) throw new Error("Metadados do MP4 fora dos limites permitidos.");
  }
  return callback;
}

async function verifyOutputRelease(callback: RenderCallback) {
  if (!callback.releaseId || !callback.assetId || !callback.fileName || !callback.fileSizeBytes) throw new Error("Asset de saída incompleto.");
  const headers = { authorization: `Bearer ${requiredActionsToken()}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const releaseResponse = await fetch(`https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/${callback.releaseId}`, { headers, signal: AbortSignal.timeout(12_000) });
  if (!releaseResponse.ok) throw new Error("Não foi possível confirmar o draft release de saída no GitHub.");
  const release = await releaseResponse.json() as { id: number; draft?: boolean };
  if (release.id !== callback.releaseId || release.draft !== true) throw new Error("O asset de render não está em um GitHub Release privado em rascunho.");
  const assetsResponse = await fetch(`https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/${callback.releaseId}/assets?per_page=100`, { headers, signal: AbortSignal.timeout(12_000) });
  if (!assetsResponse.ok) throw new Error("Não foi possível confirmar o asset do MP4 no GitHub.");
  const assets = await assetsResponse.json() as Array<{ id: number; name: string; size: number; state: string; content_type: string }>;
  const asset = assets.find(item => item.id === callback.assetId);
  if (!asset || asset.state !== "uploaded" || asset.name !== callback.fileName || asset.size !== callback.fileSizeBytes || !["video/mp4", "application/octet-stream"].includes(asset.content_type)) throw new Error("O asset do GitHub não corresponde ao MP4 e ao tamanho declarados no QA.");
}

export async function processRenderCallback(rawInput: unknown) {
  const callback = validateRenderCallback(rawInput); if (callback.status === "qa") await verifyOutputRelease(callback);
  const connection = await requirePool().connect();
  try {
    await connection.query("BEGIN");
    const jobResult = await connection.query<{ id: string; video_id: string; idea_id: string; script_id: string; script_version: number; status: string; workflow_run_id: string | null }>("SELECT id, video_id, idea_id, script_id, script_version, status, workflow_run_id::text FROM studio_render_jobs WHERE id = $1::uuid FOR UPDATE", [callback.jobId]);
    const job = jobResult.rows[0]; if (!job) throw new Error("Job de render não encontrado.");
    if (job.workflow_run_id && Number(job.workflow_run_id) !== callback.workflowRunId) throw new Error("Callback pertence a outra execução do workflow.");
    const eventInsert = await connection.query("INSERT INTO studio_render_callback_events (event_id, job_id, status) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (event_id) DO NOTHING", [callback.eventId, callback.jobId, callback.status]);
    if (eventInsert.rowCount === 0) { await connection.query("COMMIT"); return { duplicate: true, jobId: callback.jobId }; }
    if (![...JOB_ACTIVE, "failed"].includes(job.status as any)) throw new Error("O job já terminou e não aceita novos eventos.");
    const stateResult = await connection.query<{ value: any }>("SELECT value FROM app_settings WHERE key = 'studio_state' FOR UPDATE");
    const state = stateResult.rows[0]?.value; if (!state) throw new Error("Estado do estúdio não encontrado no Neon.");
    const video = state.videos?.find((item: any) => item.id === job.video_id); const idea = state.ideas?.find((item: any) => item.id === job.idea_id && !item.example); const script = state.scripts?.find((item: any) => item.id === job.script_id && !item.example); const storedJob = state.renderJobs?.find((item: any) => item.id === callback.jobId);
    if (!video || !idea || !script || !storedJob) throw new Error("O estado editorial não corresponde ao job.");
    if (script.status !== "Aprovado" || script.version !== job.script_version) throw new Error("O Portão 1 ou a versão do roteiro mudou durante o render.");
    if (callback.status === "qa") await connection.query("INSERT INTO studio_render_assets (id, script_id, script_version, github_release_id, github_asset_id, file_name, content_type, file_size_bytes, label, license) VALUES ($1::uuid, $2, $3, $4, $5, $6, 'video/mp4', $7, $8, $9) ON CONFLICT (github_asset_id) DO NOTHING", [randomUUID(), job.script_id, job.script_version, callback.releaseId, callback.assetId, callback.fileName, callback.fileSizeBytes, `MP4 de render ${callback.jobId}`, "Asset temporário interno; verifique termos de voz e fontes antes de publicar"]);
    const now = new Date().toISOString(); let finalStatus: "rendering" | "succeeded" | "failed" = callback.status === "failed" ? "failed" : "rendering"; let failedReason = callback.message;
    if (callback.status === "qa") {
      const allPassed = callback.qa!.every(check => check.passed);
      if (allPassed) {
        finalStatus = "succeeded"; const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        video.stage = "aguarda_aprov_video"; idea.status = "aguarda_aprov_video"; video.duration = formatDuration(callback.durationSeconds!); video.qa = callback.qa;
        video.releaseId = callback.releaseId; video.assetId = callback.assetId; video.fileName = callback.fileName; video.fileSizeBytes = callback.fileSizeBytes; video.finalAssetExpiresAt = expiresAt; video.simulated = false; video.synthetic = false;
        storedJob.status = "succeeded"; storedJob.progress = 100; storedJob.workflowRunId = callback.workflowRunId; storedJob.releaseId = callback.releaseId; storedJob.assetId = callback.assetId; storedJob.fileName = callback.fileName; storedJob.fileSizeBytes = callback.fileSizeBytes; storedJob.durationSeconds = callback.durationSeconds; storedJob.finishedAt = now; storedJob.expiresAt = expiresAt;
        await connection.query("UPDATE studio_render_jobs SET status = 'succeeded', progress = 100, workflow_run_id = $2, release_id = $3, asset_id = $4, file_name = $5, file_size_bytes = $6, duration_seconds = $7, qa = $8::jsonb, finished_at = NOW(), updated_at = NOW(), expires_at = $9 WHERE id = $1::uuid", [callback.jobId, callback.workflowRunId, callback.releaseId, callback.assetId, callback.fileName, callback.fileSizeBytes, callback.durationSeconds, JSON.stringify(callback.qa), expiresAt]);
      } else {
        finalStatus = "failed"; failedReason = "QA verificável reprovou um ou mais checks; o Portão 2 permanece bloqueado."; video.stage = "erro"; idea.status = "erro"; video.qa = callback.qa;
        storedJob.status = "failed"; storedJob.error = failedReason; storedJob.progress = callback.progress; storedJob.workflowRunId = callback.workflowRunId; storedJob.releaseId = callback.releaseId; storedJob.assetId = callback.assetId; storedJob.fileName = callback.fileName; storedJob.fileSizeBytes = callback.fileSizeBytes; storedJob.durationSeconds = callback.durationSeconds; storedJob.finishedAt = now;
        storedJob.errorCode = "qa_failed"; storedJob.errorOperation = "qa";
        await connection.query("UPDATE studio_render_jobs SET status = 'failed', progress = $2, workflow_run_id = $3, release_id = $4, asset_id = $5, file_name = $6, file_size_bytes = $7, duration_seconds = $8, qa = $9::jsonb, error_code = 'qa_failed', error_message = $10, finished_at = NOW(), updated_at = NOW() WHERE id = $1::uuid", [callback.jobId, callback.progress, callback.workflowRunId, callback.releaseId, callback.assetId, callback.fileName, callback.fileSizeBytes, callback.durationSeconds, JSON.stringify(callback.qa), failedReason]);
      }
    } else if (callback.status === "failed") {
      finalStatus = "failed"; failedReason = renderFailureSummary({ operation: callback.errorOperation, errorCode: callback.errorCode, httpStatus: callback.httpStatus, upstreamStatus: callback.upstreamStatus }); video.stage = "erro"; idea.status = "erro"; storedJob.status = "failed"; storedJob.error = failedReason; storedJob.errorCode = callback.errorCode ?? "render_failed"; storedJob.errorOperation = callback.errorOperation ?? "worker"; storedJob.httpStatus = callback.httpStatus; storedJob.upstreamStatus = callback.upstreamStatus; storedJob.finishedAt = now; storedJob.progress = callback.progress; storedJob.workflowRunId = callback.workflowRunId;
      await connection.query("UPDATE studio_render_jobs SET status = 'failed', progress = $2, workflow_run_id = $3, error_code = $4, error_message = $5, finished_at = NOW(), updated_at = NOW() WHERE id = $1::uuid", [callback.jobId, callback.progress, callback.workflowRunId, storedJob.errorCode, failedReason]);
    } else {
      if (job.status === "failed") throw new Error("Job falhado não pode voltar a executar sem uma nova tentativa aprovada.");
      finalStatus = "rendering"; video.stage = "render"; storedJob.status = "rendering"; storedJob.progress = callback.progress; storedJob.workflowRunId = callback.workflowRunId;
      await connection.query("UPDATE studio_render_jobs SET status = 'rendering', progress = $2, workflow_run_id = $3, started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1::uuid", [callback.jobId, callback.progress, callback.workflowRunId]);
    }
    state.audit = [{ id: randomUUID(), actor: "Sistema", action: `Render ${finalStatus}`, target: idea.title, at: now, detail: callback.status === "qa" && finalStatus === "succeeded" ? "MP4 validado no GitHub; QA concluído; aguardando Portão 2 humano." : failedReason?.slice(0, 300) ?? `Progresso ${callback.progress}%` }, ...(state.audit ?? [])].slice(0, 500);
    const oldVersion = stateVersion(state); state.version = oldVersion + 1;
    const saved = await connection.query("UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'studio_state' AND COALESCE((value->>'version')::int, 0) = $2", [JSON.stringify(state), oldVersion]);
    if (saved.rowCount !== 1) throw new Error("Conflito de versão ao atualizar o status do render.");
    await connection.query("INSERT INTO audit_log (actor, action, target, details) VALUES ('Sistema', $1, $2, $3::jsonb)", [`Render ${finalStatus}`, idea.title, JSON.stringify({ jobId: callback.jobId, workflowRunId: callback.workflowRunId, progress: callback.progress, ...(finalStatus === "failed" ? { operation: storedJob.errorOperation ?? "worker", errorCode: storedJob.errorCode ?? "render_failed", httpStatus: storedJob.httpStatus, upstreamStatus: storedJob.upstreamStatus } : {}) })]);
    await connection.query("COMMIT"); return { duplicate: false, jobId: callback.jobId, status: finalStatus, progress: callback.progress };
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}

function formatDuration(seconds: number) { const total = Math.floor(seconds); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }

export async function uploadRenderInput(params: { ideaId: string; fileName: string; contentType: string; base64: string }, ownerId: string) {
  const fileName = params.fileName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(png|jpe?g|webp)$/i.test(fileName)) throw new Error("Use um nome simples e uma imagem PNG, JPG ou WebP.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(params.contentType)) throw new Error("Formato não permitido. Envie PNG, JPEG ou WebP.");
  if (params.base64.length > 2_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(params.base64)) throw new Error("A imagem excede o limite de 2 MB ou está codificada incorretamente.");
  const data = Buffer.from(params.base64, "base64");
  if (!data.length || data.length > 2_097_152 || data.toString("base64") !== params.base64) throw new Error("A imagem excede o limite de 2 MB ou está codificada incorretamente.");
  const validMagic = params.contentType === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : params.contentType === "image/jpeg" ? data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9 : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  if (!validMagic) throw new Error("O conteúdo do arquivo não corresponde ao formato informado.");
  const connection = await requirePool().connect(); const id = randomUUID();
  try {
    await connection.query("BEGIN");
    const result = await connection.query<{ value: any }>("SELECT value FROM app_settings WHERE key = 'studio_state' FOR UPDATE"); const state = result.rows[0]?.value;
    if (!state) throw new Error("Importe primeiro o estado do Estúdio para o Neon.");
    const idea = state.ideas?.find((item: any) => item.id === params.ideaId && !item.example); const script = state.scripts?.find((item: any) => item.ideaId === params.ideaId && !item.example);
    if (!idea || !script || idea.status !== "assets" || script.status !== "Aprovado") throw new Error("Capturas só podem ser anexadas a uma pauta real com roteiro aprovado no Portão 1.");
    const counts = await connection.query<{ total: string; bytes: string }>("SELECT count(*)::text AS total, COALESCE(sum(file_size_bytes), 0)::text AS bytes FROM studio_render_inputs WHERE script_id = $1 AND script_version = $2", [script.id, script.version]);
    const total = Number(counts.rows[0]?.total ?? 0); const bytes = Number(counts.rows[0]?.bytes ?? 0);
    if (total >= 5 || bytes + data.length > 8 * 1024 * 1024) throw new Error("Limite atingido: até 5 capturas e 8 MB no total por versão do roteiro.");
    const sha256 = createHash("sha256").update(data).digest("hex");
    await connection.query("INSERT INTO studio_render_inputs (id, idea_id, script_id, script_version, file_name, content_type, file_size_bytes, sha256, data, uploaded_by) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [id, idea.id, script.id, script.version, fileName, params.contentType, data.length, sha256, data, ownerId]);
    state.assets = [{ id, inputAssetId: id, scriptId: script.id, scriptVersion: script.version, type: "Tela", label: `Captura: ${fileName}`, license: "Original · enviada pelo dono", status: "Pronto", fileName, contentType: params.contentType, sizeBytes: data.length, sha256 }, ...(state.assets ?? [])];
    const now = new Date().toISOString(); state.audit = [{ id: randomUUID(), actor: "Você", action: "Captura de produção enviada", target: idea.title, at: now, detail: `${fileName} · ${data.length} bytes · SHA-256 ${sha256.slice(0, 12)}…` }, ...(state.audit ?? [])].slice(0, 500);
    const oldVersion = stateVersion(state); state.version = oldVersion + 1;
    const saved = await connection.query("UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'studio_state' AND COALESCE((value->>'version')::int, 0) = $2", [JSON.stringify(state), oldVersion]);
    if (saved.rowCount !== 1) throw new Error("O estado mudou durante o envio. Atualize e tente novamente.");
    await connection.query("INSERT INTO audit_log (actor, action, target, details) VALUES ('Você', 'Captura de produção enviada', $1, $2::jsonb)", [idea.title, JSON.stringify({ assetId: id, fileName, fileSizeBytes: data.length, sha256, scriptVersion: script.version })]);
    await connection.query("COMMIT"); return state;
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}

export async function getRenderDownloadAsset(jobId: string) {
  if (!UUID_PATTERN.test(jobId)) throw new Error("Job de vídeo inválido.");
  const result = await requirePool().query<{ status: string; release_id: string | null; asset_id: string | null; file_name: string | null; expires_at: Date | null }>("SELECT status, release_id::text, asset_id::text, file_name, expires_at FROM studio_render_jobs WHERE id = $1::uuid LIMIT 1", [jobId]);
  const job = result.rows[0];
  if (!job || job.status !== "succeeded" || !job.release_id || !job.asset_id || !job.file_name) throw new Error("O MP4 só fica disponível depois de render e QA concluídos.");
  if (job.expires_at && job.expires_at.getTime() <= Date.now()) throw new Error("O prazo temporário do asset terminou; solicite um novo render.");
  return { releaseId: Number(job.release_id), assetId: Number(job.asset_id), fileName: job.file_name };
}


async function dispatchRenderCleanupWorkflow(jobId: string) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPOSITORY}/actions/workflows/${CLEANUP_WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${requiredActionsToken()}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { jobId } }), signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 204) throw new Error(`GitHub Actions recusou a limpeza (HTTP ${response.status}). Verifique Actions: write e se ${CLEANUP_WORKFLOW_FILE} está na branch main.`);
}

/** Remove o arquivo somente após aprovação do Portão 2; o dono confirma manualmente que já publicou. */
export async function requestRenderAssetCleanup(jobId: string) {
  if (!UUID_PATTERN.test(jobId)) throw new Error("Job de render inválido.");
  requiredActionsToken();
  const pool = requirePool();
  const jobResult = await pool.query<{ status: string; release_id: string | null }>("SELECT status, release_id::text FROM studio_render_jobs WHERE id = $1::uuid LIMIT 1", [jobId]);
  const job = jobResult.rows[0];
  if (!job || job.status !== "succeeded" || !job.release_id) throw new Error("Só é possível limpar um asset real concluído e ainda registrado.");
  const stateResult = await pool.query<{ value: any }>("SELECT value FROM app_settings WHERE key = 'studio_state' LIMIT 1");
  const currentState = stateResult.rows[0]?.value;
  const currentVideo = currentState?.videos?.find((item: any) => item.renderJobId === jobId);
  if (!currentVideo || currentVideo.simulated || !["aprovado_para_agenda", "agendado", "publicado"].includes(currentVideo.stage)) throw new Error("A limpeza só é liberada depois da aprovação humana do Portão 2.");

  await dispatchRenderCleanupWorkflow(jobId);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const lockedJob = await connection.query<{ status: string }>("SELECT status FROM studio_render_jobs WHERE id = $1::uuid FOR UPDATE", [jobId]);
    if (lockedJob.rows[0]?.status !== "succeeded") throw new Error("O job mudou de status durante a solicitação de limpeza.");
    const lockedState = await connection.query<{ value: any }>("SELECT value FROM app_settings WHERE key = 'studio_state' FOR UPDATE");
    const state = lockedState.rows[0]?.value;
    const video = state?.videos?.find((item: any) => item.renderJobId === jobId);
    if (!video || video.simulated || !["aprovado_para_agenda", "agendado", "publicado"].includes(video.stage)) throw new Error("O vídeo não está mais elegível para limpeza.");
    const now = new Date().toISOString();
    video.cleanupRequestedAt = now;
    video.finalAssetExpiresAt = now;
    const oldVersion = stateVersion(state); state.version = oldVersion + 1;
    await connection.query("UPDATE studio_render_jobs SET expires_at = NOW(), updated_at = NOW() WHERE id = $1::uuid AND status = 'succeeded'", [jobId]);
    const saved = await connection.query("UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'studio_state' AND COALESCE((value->>'version')::int, 0) = $2", [JSON.stringify(state), oldVersion]);
    if (saved.rowCount !== 1) throw new Error("O estado mudou durante a solicitação; atualize para conferir a limpeza.");
    await connection.query("INSERT INTO audit_log (actor, action, target, details) VALUES ('Você', 'Limpeza de render solicitada após publicação', $1, $2::jsonb)", [video.title, JSON.stringify({ jobId, releaseId: job.release_id })]);
    await connection.query("COMMIT");
    return state;
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}
