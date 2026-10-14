import { randomUUID } from "node:crypto";
import { getStudioPool } from "./studioRepository";

export type TtsQuotaScope = "rpm" | "tpm" | "rpd" | "tpd" | "unknown";
export type TtsPurpose = "render" | "connection_test";
export type TtsApiUsageEvent = {
  model: "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts";
  purpose: TtsPurpose;
  outcome: "success" | "failure";
  httpStatus?: number;
  quotaScope?: TtsQuotaScope;
  quotaValue?: number;
  quotaMetric?: string;
  quotaId?: string;
  retryAfterMs?: number;
};

let warnedUnavailable = false;
function warnUnavailable() {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn("[Gemini TTS] métricas/cache Neon indisponíveis; nenhum conteúdo de narração foi registrado");
}

/** Registra apenas metadados estruturados de uma chamada HTTP já realizada. */
export async function recordTtsApiCall(event: TtsApiUsageEvent): Promise<boolean> {
  const pool = getStudioPool();
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO studio_tts_usage (id, event_type, model, purpose, outcome, http_status, quota_scope, quota_value, quota_metric, quota_id, retry_after_ms)
       VALUES ($1::uuid, 'api_call', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), event.model, event.purpose, event.outcome, event.httpStatus ?? null, event.quotaScope ?? null, event.quotaValue ?? null, event.quotaMetric ?? null, event.quotaId ?? null, event.retryAfterMs ?? null],
    );
    return true;
  } catch {
    warnUnavailable();
    return false;
  }
}

export async function recordTtsCacheHit(model: TtsApiUsageEvent["model"]): Promise<void> {
  const pool = getStudioPool();
  if (!pool) return;
  try {
    await pool.query(
      "INSERT INTO studio_tts_usage (id, event_type, model, purpose, outcome) VALUES ($1::uuid, 'cache_hit', $2, 'render', NULL)",
      [randomUUID(), model],
    );
  } catch {
    warnUnavailable();
  }
}

export type TtsUsageSummary = {
  available: boolean;
  timezone: "America/Los_Angeles";
  dayStart?: string;
  resetsAt?: string;
  calls: number;
  successes: number;
  failures: number;
  cacheHits: number;
  byModel: Record<string, { calls: number; failures: number; cacheHits: number }>;
};

export async function getTtsUsageSummary(): Promise<TtsUsageSummary> {
  const empty: TtsUsageSummary = { available: false, timezone: "America/Los_Angeles", calls: 0, successes: 0, failures: 0, cacheHits: 0, byModel: {} };
  const pool = getStudioPool();
  if (!pool) return empty;
  try {
    const result = await pool.query<{
      model: string;
      api_calls: string;
      successes: string;
      failures: string;
      cache_hits: string;
      day_start: Date;
      resets_at: Date;
    }>(
      `SELECT model,
              count(*) FILTER (WHERE event_type = 'api_call')::text AS api_calls,
              count(*) FILTER (WHERE event_type = 'api_call' AND outcome = 'success')::text AS successes,
              count(*) FILTER (WHERE event_type = 'api_call' AND outcome = 'failure')::text AS failures,
              count(*) FILTER (WHERE event_type = 'cache_hit')::text AS cache_hits,
              (date_trunc('day', NOW() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles') AS day_start,
              ((date_trunc('day', NOW() AT TIME ZONE 'America/Los_Angeles') + INTERVAL '1 day') AT TIME ZONE 'America/Los_Angeles') AS resets_at
         FROM studio_tts_usage
        WHERE created_at >= (date_trunc('day', NOW() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')
        GROUP BY model`,
    );
    const summary: TtsUsageSummary = { ...empty, available: true };
    for (const row of result.rows) {
      const calls = Number(row.api_calls) || 0;
      const successes = Number(row.successes) || 0;
      const failures = Number(row.failures) || 0;
      const cacheHits = Number(row.cache_hits) || 0;
      summary.calls += calls;
      summary.successes += successes;
      summary.failures += failures;
      summary.cacheHits += cacheHits;
      summary.byModel[row.model] = { calls, failures, cacheHits };
      summary.dayStart ??= row.day_start.toISOString();
      summary.resetsAt ??= row.resets_at.toISOString();
    }
    if (!summary.dayStart || !summary.resetsAt) {
      const bounds = await pool.query<{ day_start: Date; resets_at: Date }>(
        `SELECT (date_trunc('day', NOW() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles') AS day_start,
                ((date_trunc('day', NOW() AT TIME ZONE 'America/Los_Angeles') + INTERVAL '1 day') AT TIME ZONE 'America/Los_Angeles') AS resets_at`,
      );
      summary.dayStart = bounds.rows[0]?.day_start.toISOString();
      summary.resetsAt = bounds.rows[0]?.resets_at.toISOString();
    }
    return summary;
  } catch {
    warnUnavailable();
    return empty;
  }
}
