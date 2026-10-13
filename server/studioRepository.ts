import { Pool } from "pg";

export type AuditWrite = {
  actor: "Você" | "Nexo" | "Sistema";
  action: string;
  target: string;
  details?: Record<string, unknown>;
};

export type LLMUsageWrite = {
  provider: "gemini" | "groq";
  task: "roteiro" | "qa" | "agente" | "leve";
  outcome: "success" | "failure";
  reason: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

let pool: Pool | undefined;

function getNeonPool() {
  const connectionString = process.env.STUDIO_DATABASE_URL;
  if (!connectionString) return undefined;
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export function studioPersistenceStatus() {
  return {
    mode: process.env.STUDIO_DATABASE_URL ? "neon" : "local",
    detail: process.env.STUDIO_DATABASE_URL
      ? "Neon configurado por segredo de ambiente."
      : "Modo local persistente: adicione DATABASE_URL no cofre para sincronizar com Neon.",
  } as const;
}

export async function appendStudioAudit(entry: AuditWrite) {
  const client = getNeonPool();
  if (!client) return { persisted: false as const, mode: "local" as const };
  try {
    await client.query(
      "INSERT INTO audit_log (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)",
      [entry.actor, entry.action, entry.target, JSON.stringify(entry.details ?? {})]
    );
    return { persisted: true as const, mode: "neon" as const };
  } catch {
    // Não registrar detalhes de conexão nem segredos em logs de aplicação.
    console.warn("[Estúdio] Persistência de auditoria indisponível.");
    return { persisted: false as const, mode: "neon" as const };
  }
}

export async function verifyStudioDatabase() {
  const client = getNeonPool();
  if (!client) return { reachable: false as const, ...studioPersistenceStatus() };
  try {
    const result = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'");
    return { reachable: true as const, ...studioPersistenceStatus(), tableCount: Number(result.rows[0]?.count ?? 0) };
  } catch {
    return { reachable: false as const, ...studioPersistenceStatus() };
  }
}

export async function getLLMProviderSettings(): Promise<Record<string, unknown> | null> {
  const client = getNeonPool();
  if (!client) return null;
  try {
    const result = await client.query<{ value: Record<string, unknown> }>("SELECT value FROM app_settings WHERE key = 'llm_provider_settings' LIMIT 1");
    return result.rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function saveLLMProviderSettings(value: { gemini: unknown; groq: unknown }) {
  const client = getNeonPool();
  if (!client) return value;
  await client.query(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('llm_provider_settings', $1::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
    [JSON.stringify(value)]
  );
  return value;
}

export async function recordLLMUsage(entry: LLMUsageWrite) {
  const client = getNeonPool();
  if (!client) return { persisted: false as const };
  try {
    await client.query(
      "INSERT INTO llm_usage_log (provider, task, outcome, reason, latency_ms, input_tokens, output_tokens) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [entry.provider, entry.task, entry.outcome, entry.reason, entry.latencyMs, entry.inputTokens ?? 0, entry.outputTokens ?? 0]
    );
    return { persisted: true as const };
  } catch {
    console.warn("[Estúdio] Persistência de uso LLM indisponível.");
    return { persisted: false as const };
  }
}

export async function getLLMUsageSummary() {
  const client = getNeonPool();
  const empty = { callsToday: 0, successesToday: 0, failuresToday: 0, fallbacksToday: 0, inputTokensToday: 0, outputTokensToday: 0, byProvider: { gemini: { calls: 0, successes: 0, failures: 0 }, groq: { calls: 0, successes: 0, failures: 0 } } };
  if (!client) return empty;
  try {
    const result = await client.query<{ provider: "gemini" | "groq"; outcome: "success" | "failure"; calls: string; input_tokens: string; output_tokens: string; fallbacks: string }>(
      "SELECT provider, outcome, count(*)::text AS calls, COALESCE(sum(input_tokens), 0)::text AS input_tokens, COALESCE(sum(output_tokens), 0)::text AS output_tokens, count(*) FILTER (WHERE reason LIKE 'fallback%')::text AS fallbacks FROM llm_usage_log WHERE created_at >= CURRENT_DATE GROUP BY provider, outcome"
    );
    const summary = structuredClone(empty);
    for (const row of result.rows) {
      const calls = Number(row.calls); const input = Number(row.input_tokens); const output = Number(row.output_tokens); const fallbacks = Number(row.fallbacks);
      summary.callsToday += calls; summary.inputTokensToday += input; summary.outputTokensToday += output; summary.fallbacksToday += fallbacks;
      summary.byProvider[row.provider].calls += calls;
      if (row.outcome === "success") { summary.successesToday += calls; summary.byProvider[row.provider].successes += calls; }
      else { summary.failuresToday += calls; summary.byProvider[row.provider].failures += calls; }
    }
    return summary;
  } catch {
    return empty;
  }
}
