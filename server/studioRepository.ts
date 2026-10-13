import { Pool } from "pg";
import { randomUUID } from "node:crypto"

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

export async function getStudioQueueSummary() {
  const client = getNeonPool();
  if (!client) return { persisted: false as const, ideas: {}, videos: {}, jobs: {} };
  try {
    const [ideas, videos, jobs] = await Promise.all([
      client.query<{ status: string; count: string }>("SELECT status, count(*)::text AS count FROM ideas GROUP BY status"),
      client.query<{ state: string; count: string }>("SELECT state, count(*)::text AS count FROM videos GROUP BY state"),
      client.query<{ status: string; count: string }>("SELECT status, count(*)::text AS count FROM render_jobs GROUP BY status"),
    ]);
    return {
      persisted: true as const,
      ideas: Object.fromEntries(ideas.rows.map(row => [row.status, Number(row.count)])),
      videos: Object.fromEntries(videos.rows.map(row => [row.state, Number(row.count)])),
      jobs: Object.fromEntries(jobs.rows.map(row => [row.status, Number(row.count)])),
    };
  } catch {
    return { persisted: false as const, ideas: {}, videos: {}, jobs: {} };
  }
}

export async function getStoredOwnerPasswordHash() {
  const client = getNeonPool(); if (!client) return null;
  try { const result = await client.query<{ value: string }>("SELECT value #>> '{}' AS value FROM app_settings WHERE key = 'owner_password_hash' LIMIT 1"); return result.rows[0]?.value ?? null; } catch { return null; }
}
export async function setStoredOwnerPasswordHash(hash: string) {
  const client = getNeonPool(); if (!client) throw new Error("Neon não configurado para armazenar a senha.");
  await client.query("INSERT INTO app_settings (key, value, updated_at) VALUES ('owner_password_hash', to_jsonb($1::text), NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()", [hash]);
}
export async function checkRateLimit(keys: string[], limit: number) {
  const client = getNeonPool(); if (!client) return true;
  const connection = await client.connect();
  try { await connection.query("BEGIN"); for (const key of keys) { const result = await connection.query<{ blocked_until: Date | null; window_started: Date; calls: number }>("SELECT blocked_until, window_started, calls FROM rate_limit_state WHERE key = $1 FOR UPDATE", [key]); const row = result.rows[0]; if (row?.blocked_until && row.blocked_until.getTime() > Date.now()) { await connection.query("COMMIT"); return false; } if (row && Date.now() - row.window_started.getTime() >= 60_000) await connection.query("UPDATE rate_limit_state SET window_started = NOW(), calls = 0, updated_at = NOW() WHERE key = $1", [key]); } await connection.query("COMMIT"); return true; } catch { await connection.query("ROLLBACK"); return true; } finally { connection.release(); }
}
export async function consumeRateLimit(key: string, limit: number) {
  const client = getNeonPool(); if (!client) return true;
  const connection = await client.connect();
  try { await connection.query("BEGIN"); const result = await connection.query<{ window_started: Date; calls: number }>("SELECT window_started, calls FROM rate_limit_state WHERE key = $1 FOR UPDATE", [key]); const row = result.rows[0]; if (!row || Date.now() - row.window_started.getTime() >= 60_000) await connection.query("INSERT INTO rate_limit_state (key, window_started, calls, updated_at) VALUES ($1, NOW(), 1, NOW()) ON CONFLICT (key) DO UPDATE SET window_started = NOW(), calls = 1, updated_at = NOW()", [key]); else if (row.calls >= limit) { await connection.query("ROLLBACK"); return false; } else await connection.query("UPDATE rate_limit_state SET calls = calls + 1, updated_at = NOW() WHERE key = $1", [key]); await connection.query("COMMIT"); return true; } catch { await connection.query("ROLLBACK"); return true; } finally { connection.release(); }
}
export async function recordAuthFailure(keys: string[]) {
  const client = getNeonPool(); if (!client) return;
  for (const key of keys) await client.query("INSERT INTO rate_limit_state (key, failed_attempts, blocked_until, updated_at) VALUES ($1, 1, NULL, NOW()) ON CONFLICT (key) DO UPDATE SET failed_attempts = rate_limit_state.failed_attempts + 1, blocked_until = CASE WHEN key = 'auth:global' AND rate_limit_state.failed_attempts + 1 >= 50 THEN NOW() + INTERVAL '10 minutes' WHEN key <> 'auth:global' AND rate_limit_state.failed_attempts + 1 >= 20 THEN NOW() + INTERVAL '1 hour' WHEN key <> 'auth:global' AND rate_limit_state.failed_attempts + 1 >= 10 THEN NOW() + INTERVAL '10 minutes' WHEN key <> 'auth:global' AND rate_limit_state.failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '1 minute' ELSE rate_limit_state.blocked_until END, updated_at = NOW()", [key]);
}
export function authRatePolicy(key: string) { return key === "auth:global" ? { maxFailures: 50, maxBlockMinutes: 10 } : { maxFailures: 20, maxBlockMinutes: 60 }; }
export async function resetAuthFailures(keys: string[]) { const client = getNeonPool(); if (!client) return; await client.query("UPDATE rate_limit_state SET failed_attempts = 0, blocked_until = NULL, updated_at = NOW() WHERE key = ANY($1::text[])", [keys]); }
export async function createAgentConfirmation(action: string, payload: Record<string, unknown>) { const client = getNeonPool(); const id = randomUUID(); if (!client) return id; await client.query("INSERT INTO agent_confirmations (id, action, payload) VALUES ($1, $2, $3::jsonb)", [id, action, JSON.stringify(payload)]); return id; }
export async function resolveAgentConfirmation(id: string, approved: boolean) { const client = getNeonPool(); if (!client) return null; const result = await client.query<{ action: string; payload: Record<string, unknown> }>("UPDATE agent_confirmations SET status = $2, resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING action, payload", [id, approved ? "approved" : "cancelled"]); return result.rows[0] ?? null; }

export async function getCredentialVersion() { const client = getNeonPool(); if (!client) return 1; try { const result = await client.query<{ value: number }>("SELECT (value #>> '{}')::int AS value FROM app_settings WHERE key = 'owner_pwd_version' LIMIT 1"); return Number(result.rows[0]?.value ?? 1); } catch { return 1; } }
export async function bumpCredentialVersion() { const next = (await getCredentialVersion()) + 1; const client = getNeonPool(); if (!client) return next; await client.query("INSERT INTO app_settings (key, value, updated_at) VALUES ('owner_pwd_version', to_jsonb($1::int), NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()", [next]); return next; }
export async function getStudioState() { const client = getNeonPool(); if (!client) return null; try { const result = await client.query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = 'studio_state' LIMIT 1"); return result.rows[0]?.value ?? null; } catch { return null; } }
export async function saveStudioState(value: any, options: { allowPublicationAutomation?: boolean } = {}) { const client = getNeonPool(); if (!client) throw new Error("Neon não configurado para o estado do estúdio."); const current = await getStudioState() as any; if (!options.allowPublicationAutomation && value?.settings?.automation?.publicacao === "Automática" && current?.settings?.automation?.publicacao !== "Automática") throw new Error("Publicação automática só pode ser habilitada após confirmação server-side."); await client.query("INSERT INTO app_settings (key, value, updated_at) VALUES ('studio_state', $1::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()", [JSON.stringify(value)]); return value; }
