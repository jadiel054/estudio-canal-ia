import { TtsProviderError } from "./ttsProvider";

export const RENDER_OPERATIONS = [
  "manifest",
  "voice",
  "input",
  "callback",
  "render",
  "qa",
  "release",
  "dispatch",
  "worker",
  "unknown",
] as const;
export type RenderOperation = typeof RENDER_OPERATIONS[number];

export const RENDER_ERROR_CODES = [
  "render_unauthorized",
  "render_operation_not_found",
  "invalid_json_body",
  "invalid_job_id",
  "invalid_voice_request",
  "invalid_input_request",
  "tts_invalid_key",
  "tts_unavailable",
  "tts_invalid_audio",
  "tts_network",
  "tts_timeout",
  "manifest_operation_failed",
  "voice_operation_failed",
  "input_operation_failed",
  "callback_operation_failed",
  "render_failed",
  "qa_failed",
  "release_failed",
  "dispatch_failed",
  "worker_unexpected",
  "render_network_error",
  "ffmpeg_failed",
  "invalid_response_signature",
  "invalid_tts_wav",
  "invalid_tts_duration",
  "manifest_invalid",
  "callback_not_confirmed",
  "github_api_failed",
  "github_upload_failed",
  "render_http_error",
] as const;
export type RenderErrorCode = typeof RENDER_ERROR_CODES[number];

export function isRenderOperation(value: unknown): value is RenderOperation {
  return typeof value === "string" && (RENDER_OPERATIONS as readonly string[]).includes(value);
}

export function isRenderErrorCode(value: unknown): value is RenderErrorCode {
  return typeof value === "string" && (RENDER_ERROR_CODES as readonly string[]).includes(value);
}

const OPERATION_FAILURE_CODE: Record<RenderOperation, RenderErrorCode> = {
  manifest: "manifest_operation_failed",
  voice: "voice_operation_failed",
  input: "input_operation_failed",
  callback: "callback_operation_failed",
  render: "render_failed",
  qa: "qa_failed",
  release: "release_failed",
  dispatch: "dispatch_failed",
  worker: "worker_unexpected",
  unknown: "worker_unexpected",
};

export function classifyRenderFailure(operation: RenderOperation, error: unknown): {
  errorCode: RenderErrorCode;
  upstreamStatus?: number;
} {
  if (error instanceof TtsProviderError) {
    const errorCode = `tts_${error.kind}`;
    return {
      errorCode: isRenderErrorCode(errorCode) ? errorCode : "tts_unavailable",
      ...(Number.isInteger(error.status) && error.status! >= 100 && error.status! <= 599
        ? { upstreamStatus: error.status }
        : {}),
    };
  }
  return { errorCode: OPERATION_FAILURE_CODE[operation] };
}

export type RenderFailureDiagnostic = {
  operation: RenderOperation;
  errorCode: RenderErrorCode;
  httpStatus?: number;
  upstreamStatus?: number;
};

/** Texto persistido/logado: somente enums e status numéricos, nunca mensagem livre. */
export function renderFailureSummary(value: Partial<RenderFailureDiagnostic>): string {
  const operation = isRenderOperation(value.operation) ? value.operation : "worker";
  const errorCode = isRenderErrorCode(value.errorCode) ? value.errorCode : "render_failed";
  const parts = [`operation=${operation}`, `code=${errorCode}`];
  if (Number.isInteger(value.httpStatus) && value.httpStatus! >= 100 && value.httpStatus! <= 599) parts.push(`http=${value.httpStatus}`);
  if (Number.isInteger(value.upstreamStatus) && value.upstreamStatus! >= 100 && value.upstreamStatus! <= 599) parts.push(`upstream=${value.upstreamStatus}`);
  return parts.join(" ");
}
