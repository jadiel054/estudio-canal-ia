import { TtsProviderError, type TtsModel } from "./ttsProvider";
import type { TtsQuotaScope } from "./ttsUsage";

export const RENDER_OPERATIONS = ["manifest", "voice", "input", "callback", "render", "qa", "release", "dispatch", "worker", "unknown"] as const;
export type RenderOperation = typeof RENDER_OPERATIONS[number];

export const RENDER_ERROR_CODES = [
  "render_unauthorized", "render_operation_not_found", "invalid_json_body", "invalid_job_id", "invalid_voice_request", "invalid_input_request",
  "tts_invalid_key", "tts_unavailable", "tts_invalid_audio", "tts_network", "tts_timeout", "tts_quota_daily", "tts_quota_minute", "tts_quota_unknown",
  "manifest_operation_failed", "voice_operation_failed", "input_operation_failed", "callback_operation_failed", "render_failed", "qa_failed",
  "release_failed", "dispatch_failed", "worker_unexpected", "render_network_error", "ffmpeg_failed", "invalid_response_signature",
  "invalid_tts_wav", "invalid_tts_duration", "manifest_invalid", "callback_not_confirmed", "github_api_failed", "github_upload_failed", "render_http_error",
] as const;
export type RenderErrorCode = typeof RENDER_ERROR_CODES[number];

export function isRenderOperation(value: unknown): value is RenderOperation {
  return typeof value === "string" && (RENDER_OPERATIONS as readonly string[]).includes(value);
}
export function isRenderErrorCode(value: unknown): value is RenderErrorCode {
  return typeof value === "string" && (RENDER_ERROR_CODES as readonly string[]).includes(value);
}

const OPERATION_FAILURE_CODE: Record<RenderOperation, RenderErrorCode> = {
  manifest: "manifest_operation_failed", voice: "voice_operation_failed", input: "input_operation_failed", callback: "callback_operation_failed",
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
