import { TtsProviderError, type TtsModel } from "./ttsProvider";
import type { TtsQuotaScope } from "./ttsUsage";

export const RENDER_OPERATIONS = ["manifest", "voice", "input", "image", "callback", "render", "qa", "release", "dispatch", "worker", "unknown"] as const;
export type RenderOperation = typeof RENDER_OPERATIONS[number];

export const RENDER_ERROR_CODES = [
  "render_unauthorized", "render_operation_not_found", "invalid_json_body", "invalid_job_id", "invalid_voice_request", "invalid_input_request", "invalid_image_request",
  "tts_invalid_key", "tts_unavailable", "tts_invalid_audio", "tts_network", "tts_timeout", "tts_quota_daily", "tts_quota_minute", "tts_quota_unknown",
  "manifest_operation_failed", "voice_operation_failed", "input_operation_failed", "image_operation_failed", "callback_operation_failed", "callback_signature_invalid", "callback_payload_invalid",
  "callback_idempotency_failed", "callback_job_state_rejected", "callback_release_verification_failed", "callback_database_update_failed", "render_failed", "qa_failed",
  "release_failed", "dispatch_failed", "worker_unexpected", "render_network_error", "ffmpeg_failed", "invalid_response_signature",
  "invalid_tts_wav", "invalid_tts_duration", "manifest_invalid", "callback_not_confirmed", "github_api_failed", "github_upload_failed", "render_http_error",
] as const;
export type RenderErrorCode = typeof RENDER_ERROR_CODES[number];

export const RENDER_CALLBACK_STAGE_CODES = [
  "assinatura", "validacao_payload", "idempotencia", "estado_job", "verificacao_release", "update_banco",
  "verificacao_release_metadados", "verificacao_release_consulta", "verificacao_release_resposta", "verificacao_release_estado",
  "verificacao_assets_consulta", "verificacao_assets_resposta", "verificacao_asset_ausente", "verificacao_asset_estado",
  "verificacao_asset_nome", "verificacao_asset_tamanho", "verificacao_asset_tipo",
] as const;
export type RenderCallbackStageCode = typeof RENDER_CALLBACK_STAGE_CODES[number];

const CALLBACK_STAGE_ERROR_CODES: Record<RenderCallbackStageCode, RenderErrorCode> = {
  assinatura: "callback_signature_invalid",
  validacao_payload: "callback_payload_invalid",
  idempotencia: "callback_idempotency_failed",
  estado_job: "callback_job_state_rejected",
  verificacao_release: "callback_release_verification_failed",
  verificacao_release_metadados: "callback_release_verification_failed",
  verificacao_release_consulta: "callback_release_verification_failed",
  verificacao_release_resposta: "callback_release_verification_failed",
  verificacao_release_estado: "callback_release_verification_failed",
  verificacao_assets_consulta: "callback_release_verification_failed",
  verificacao_assets_resposta: "callback_release_verification_failed",
  verificacao_asset_ausente: "callback_release_verification_failed",
  verificacao_asset_estado: "callback_release_verification_failed",
  verificacao_asset_nome: "callback_release_verification_failed",
  verificacao_asset_tamanho: "callback_release_verification_failed",
  verificacao_asset_tipo: "callback_release_verification_failed",
  update_banco: "callback_database_update_failed",
};

export function isRenderCallbackStageCode(value: unknown): value is RenderCallbackStageCode {
  return typeof value === "string" && (RENDER_CALLBACK_STAGE_CODES as readonly string[]).includes(value);
}

export function callbackStageDiagnostic(stageCode: RenderCallbackStageCode): RenderFailureDiagnostic {
  return { operation: "callback", errorCode: CALLBACK_STAGE_ERROR_CODES[stageCode], stageCode };
}

export class RenderCallbackStageError extends Error {
  readonly operation = "callback" as const;
  readonly errorCode: RenderErrorCode;

  constructor(readonly stageCode: RenderCallbackStageCode) {
    const diagnostic = callbackStageDiagnostic(stageCode);
    super(diagnostic.errorCode);
    this.name = "RenderCallbackStageError";
    this.errorCode = diagnostic.errorCode;
  }
}

export function isRenderOperation(value: unknown): value is RenderOperation {
  return typeof value === "string" && (RENDER_OPERATIONS as readonly string[]).includes(value);
}
export function isRenderErrorCode(value: unknown): value is RenderErrorCode {
  return typeof value === "string" && (RENDER_ERROR_CODES as readonly string[]).includes(value);
}

const OPERATION_FAILURE_CODE: Record<RenderOperation, RenderErrorCode> = {
  manifest: "manifest_operation_failed", voice: "voice_operation_failed", input: "input_operation_failed", image: "image_operation_failed", callback: "callback_operation_failed",
  render: "render_failed", qa: "qa_failed", release: "release_failed", dispatch: "dispatch_failed", worker: "worker_unexpected", unknown: "worker_unexpected",
};
const QUOTA_SCOPES: readonly TtsQuotaScope[] = ["rpm", "tpm", "rpd", "tpd", "unknown"];
const TTS_MODELS: readonly TtsModel[] = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
function isSafeQuotaIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_./:-]{1,120}$/.test(value);
}
function isSafeQuotaValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000_000;
}
function isSafeRetry(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 604_800_000;
}

export type RenderFailureDiagnostic = {
  operation: RenderOperation;
  errorCode: RenderErrorCode;
  stageCode?: RenderCallbackStageCode;
  httpStatus?: number;
  upstreamStatus?: number;
  quotaScope?: TtsQuotaScope;
  quotaValue?: number;
  quotaMetric?: string;
  quotaId?: string;
  retryAfterMs?: number;
  providerModel?: TtsModel;
};

export function classifyRenderFailure(operation: RenderOperation, error: unknown): RenderFailureDiagnostic {
  if (error instanceof RenderCallbackStageError) {
    return { operation: "callback", errorCode: error.errorCode, stageCode: error.stageCode };
  }
  if (error instanceof TtsProviderError) {
    const errorCode: RenderErrorCode = error.kind === "quota_daily" ? "tts_quota_daily"
      : error.kind === "quota_minute" ? "tts_quota_minute"
        : error.kind === "quota_unknown" ? "tts_quota_unknown"
          : error.kind === "invalid_key" ? "tts_invalid_key"
            : error.kind === "invalid_audio" ? "tts_invalid_audio"
              : error.kind === "network" ? "tts_network"
                : error.kind === "timeout" ? "tts_timeout" : "tts_unavailable";
    return {
      operation,
      errorCode,
      ...(Number.isInteger(error.status) && error.status! >= 100 && error.status! <= 599 ? { upstreamStatus: error.status } : {}),
      ...(error.model && TTS_MODELS.includes(error.model) ? { providerModel: error.model } : {}),
      ...(error.quota && QUOTA_SCOPES.includes(error.quota.scope) ? {
        quotaScope: error.quota.scope,
        ...(isSafeQuotaValue(error.quota.value) ? { quotaValue: error.quota.value } : {}),
        ...(isSafeQuotaIdentifier(error.quota.metric) ? { quotaMetric: error.quota.metric } : {}),
        ...(isSafeQuotaIdentifier(error.quota.id) ? { quotaId: error.quota.id } : {}),
        ...(isSafeRetry(error.quota.retryAfterMs) ? { retryAfterMs: error.quota.retryAfterMs } : {}),
      } : {}),
    };
  }
  return { operation, errorCode: OPERATION_FAILURE_CODE[operation] };
}

/** Registro estruturado allowlisted; nunca inclui mensagem, payload ou conteúdo editorial. */
export function renderFailureLogRecord(diagnostic: RenderFailureDiagnostic, httpStatus: number) {
  const operation = isRenderOperation(diagnostic.operation) ? diagnostic.operation : "worker";
  const errorCode = isRenderErrorCode(diagnostic.errorCode) ? diagnostic.errorCode : "render_failed";
  const safeStatus = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : 500;
  return {
    event: "falha_operacao_render",
    operation,
    errorCode,
    httpStatus: safeStatus,
    ...(isRenderCallbackStageCode(diagnostic.stageCode) ? { stageCode: diagnostic.stageCode } : {}),
    ...(Number.isInteger(diagnostic.upstreamStatus) && diagnostic.upstreamStatus! >= 100 && diagnostic.upstreamStatus! <= 599 ? { upstreamStatus: diagnostic.upstreamStatus } : {}),
    ...(diagnostic.quotaScope && QUOTA_SCOPES.includes(diagnostic.quotaScope) ? { quotaScope: diagnostic.quotaScope } : {}),
    ...(isSafeQuotaValue(diagnostic.quotaValue) ? { quotaValue: diagnostic.quotaValue } : {}),
    ...(isSafeQuotaIdentifier(diagnostic.quotaMetric) ? { quotaMetric: diagnostic.quotaMetric } : {}),
    ...(isSafeQuotaIdentifier(diagnostic.quotaId) ? { quotaId: diagnostic.quotaId } : {}),
    ...(isSafeRetry(diagnostic.retryAfterMs) ? { retryAfterMs: diagnostic.retryAfterMs } : {}),
    ...(diagnostic.providerModel && TTS_MODELS.includes(diagnostic.providerModel) ? { providerModel: diagnostic.providerModel } : {}),
  };
}

/** Texto persistido/logado: somente enums, identificadores restritos e números — nunca mensagem livre. */
export function renderFailureSummary(value: Partial<RenderFailureDiagnostic>): string {
  const operation = isRenderOperation(value.operation) ? value.operation : "worker";
  const errorCode = isRenderErrorCode(value.errorCode) ? value.errorCode : "render_failed";
  const parts = [`operation=${operation}`, `code=${errorCode}`];
  if (Number.isInteger(value.httpStatus) && value.httpStatus! >= 100 && value.httpStatus! <= 599) parts.push(`http=${value.httpStatus}`);
  if (Number.isInteger(value.upstreamStatus) && value.upstreamStatus! >= 100 && value.upstreamStatus! <= 599) parts.push(`upstream=${value.upstreamStatus}`);
  if (value.quotaScope && QUOTA_SCOPES.includes(value.quotaScope)) parts.push(`quota=${value.quotaScope}`);
  if (isSafeQuotaValue(value.quotaValue)) parts.push(`quotaValue=${value.quotaValue}`);
  if (isSafeQuotaIdentifier(value.quotaMetric)) parts.push(`quotaMetric=${value.quotaMetric}`);
  if (isSafeQuotaIdentifier(value.quotaId)) parts.push(`quotaId=${value.quotaId}`);
  if (isSafeRetry(value.retryAfterMs)) parts.push(`retryAfterMs=${value.retryAfterMs}`);
  if (value.providerModel && TTS_MODELS.includes(value.providerModel)) parts.push(`model=${value.providerModel}`);
  return parts.join(" ");
}
