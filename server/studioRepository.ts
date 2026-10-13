import { Pool } from "pg";
import { randomUUID } from "node:crypto"

export type AuditWrite = {
  /** Ator real da ação: dono autenticado, agente Nexo ou o próprio sistema. */
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

/**
 * Conflito de concorrência otimista.
 *
 * Os comandos editoriais leem o estado inteiro, alteram e gravam. Para impedir
 * que dois comandos simultâneos sobrescrevam um ao outro, cada gravação carrega
 * a versão lida e a instrução SQL só afeta a linha quando a versão no banco
 * continua a mesma (`WHERE ... version = $2`). Sem linhas afetadas = conflito.
 */
export class StateConflictError extends Error {
  constructor(message = "Conflito de concorrência: outra operação salvou o estado do estúdio ao mesmo tempo. Recarregue a tela e repita a ação.") {
    super(message);
    this.name = "StateConflictError";
  }
}

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
  for (const key of keys) await client.query("INSERT INTO rate_limit_state (key, failed_attempts, blocked_until, updated_at) VALUES ($1, 1, NULL, NOW()) ON CONFLICT (key) DO UPDATE SET failed_attempts = rate_limit_state.failed_attempts + 1, blocked_until = CASE WHEN key = 'auth:global' AND rate_limit_state.failed_attempts + 1 >= 50 THEN NOW() + INTERVAL '10 minutes' WHEN key <> 'auth:global' AND rate_limit_state.failed_attempts + 1 >= 10 THEN NOW() + INTERVAL '10 minutes' WHEN key <> 'auth:global' AND rate_limit_state.failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '1 minute' ELSE rate_limit_state.blocked_until END, updated_at = NOW()", [key]);
}
export function authRatePolicy(key: string) { return key === "auth:global" ? { maxFailures: 50, maxBlockMinutes: 10 } : { maxFailures: 20, maxBlockMinutes: 60 }; }
export async function resetAuthFailures(keys: string[]) { const client = getNeonPool(); if (!client) return; await client.query("UPDATE rate_limit_state SET failed_attempts = 0, blocked_until = NULL, updated_at = NOW() WHERE key = ANY($1::text[])", [keys]); }
export async function createAgentConfirmation(action: string, payload: Record<string, unknown>) { const client = getNeonPool(); const id = randomUUID(); if (!client) return id; await client.query("INSERT INTO agent_confirmations (id, action, payload) VALUES ($1, $2, $3::jsonb)", [id, action, JSON.stringify(payload)]); return id; }
export async function resolveAgentConfirmation(id: string, approved: boolean) { const client = getNeonPool(); if (!client) return null; const result = await client.query<{ action: string; payload: Record<string, unknown> }>("UPDATE agent_confirmations SET status = $2, resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING action, payload", [id, approved ? "approved" : "cancelled"]); return result.rows[0] ?? null; }

/** Verdadeiro quando o dono já confirmou explicitamente a publicação automática no servidor. */
export async function hasApprovedAutomaticPublication() {
  const client = getNeonPool(); if (!client) return false;
  try {
    const result = await client.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM agent_confirmations WHERE action = 'publicacao_automatica' AND status = 'approved') AS exists");
    return Boolean(result.rows[0]?.exists);
  } catch { return false; }
}

export async function getCredentialVersion() { const client = getNeonPool(); if (!client) return 1; try { const result = await client.query<{ value: number }>("SELECT (value #>> '{}')::int AS value FROM app_settings WHERE key = 'owner_pwd_version' LIMIT 1"); return Number(result.rows[0]?.value ?? 1); } catch { return 1; } }
export async function bumpCredentialVersion() { const next = (await getCredentialVersion()) + 1; const client = getNeonPool(); if (!client) return next; await client.query("INSERT INTO app_settings (key, value, updated_at) VALUES ('owner_pwd_version', to_jsonb($1::int), NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()", [next]); return next; }

/** Versão lida do estado. Estados legados (sem versão) contam como 0. */
export function stateVersion(value: unknown): number {
  const raw = (value as { version?: unknown } | null)?.version;
  return Number.isSafeInteger(raw) && Number(raw) > 0 ? Number(raw) : 0;
}

export async function getStudioState() { const client = getNeonPool(); if (!client) return null; try { const result = await client.query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = 'studio_state' LIMIT 1"); return result.rows[0]?.value ?? null; } catch { return null; } }

/**
 * Grava o estado do estúdio com controle otimista de versão.
 *
 * - `expectedVersion` informado: a gravação só acontece se a versão no Neon for
 *   exatamente essa. Caso contrário, lança `StateConflictError` sem gravar nada.
 * - `expectedVersion` ausente: gravação incondicional (importação explícita),
 *   sempre incrementando a versão.
 */
export async function saveStudioState(value: any, options: { allowPublicationAutomation?: boolean; expectedVersion?: number } = {}) {
  const client = getNeonPool();
  if (!client) throw new Error("Neon não configurado para o estado do estúdio.");
  const current = await getStudioState() as any;
  const currentVersion = stateVersion(current);
  if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) throw new StateConflictError();
  if (!options.allowPublicationAutomation && value?.settings?.automation?.publicacao === "Automática" && current?.settings?.automation?.publicacao !== "Automática") throw new Error("Publicação automática só pode ser habilitada após confirmação server-side.");
  const next = { ...value, version: currentVersion + 1 };
  if (!current) {
    const inserted = await client.query("INSERT INTO app_settings (key, value, updated_at) VALUES ('studio_state', $1::jsonb, NOW()) ON CONFLICT (key) DO NOTHING", [JSON.stringify(next)]);
    if (inserted.rowCount === 0) throw new StateConflictError();
    return next;
  }
  const updated = await client.query("UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'studio_state' AND COALESCE((value->>'version')::int, 0) = $2", [JSON.stringify(next), currentVersion]);
  if (updated.rowCount === 0) throw new StateConflictError();
  return next;
}

/**
 * Salva somente as fatias não editoriais (configurações, adaptadores, conexões,
 * chat e auditoria). Faz nova leitura e nova tentativa em caso de conflito,
 * porque nunca disputa as fatias que os comandos editoriais alteram.
 */
export async function saveStudioNonEditorialState(value: any) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getStudioState() as any;
    if (!current) throw new Error("O estado editorial ainda não foi importado para o Neon.");
    const merged = { ...current, settings: value?.settings ?? current.settings, adapters: value?.adapters ?? current.adapters, connections: value?.connections ?? current.connections, chat: value?.chat ?? current.chat, audit: value?.audit ?? current.audit };
    try {
      return await saveStudioState(merged, { allowPublicationAutomation: false, expectedVersion: stateVersion(current) });
    } catch (error) {
      if (error instanceof StateConflictError && attempt < 2) continue;
      throw error;
    }
  }
  throw new StateConflictError();
}


// --- Radar real: sinais e observações são isolados do estado editorial. ---
export type RadarRunWrite = {
  id: string;
  startedAt: Date;
  finishedAt: Date;
  trigger: "manual" | "cron";
  sources: Array<{ source: string; ok: boolean; count: number; error?: string }>;
  classified: number;
};

export async function getRadarBaselines(signalKeys: string[]): Promise<Map<string, { metric: number; observedAt: string }>> {
  const client = getNeonPool();
  if (!client) throw new Error("Neon indisponível: o Radar real precisa do banco configurado.");
  if (!signalKeys.length) return new Map();
  const result = await client.query<{ signal_key: string; metric: number; observed_at: Date }>(
    "SELECT DISTINCT ON (signal_key) signal_key, metric, observed_at FROM radar_observations WHERE signal_key = ANY($1::text[]) ORDER BY signal_key, observed_at DESC",
    [signalKeys],
  );
  return new Map(result.rows.map(row => [row.signal_key, { metric: Number(row.metric), observedAt: new Date(row.observed_at).toISOString() }]));
}

export async function persistRadarBatch(signals: Array<Record<string, any> & { observedMetric: number }>, run: RadarRunWrite) {
  const pool = getNeonPool();
  if (!pool) throw new Error("Neon indisponível: o Radar real precisa do banco configurado.");
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    for (const signal of signals) {
      const signalKey = `${signal.source}:${signal.externalId}`;
      await connection.query(
        `INSERT INTO radar_signals (signal_key, source, title, url, score, collected_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)
         ON CONFLICT (signal_key) DO UPDATE SET source = EXCLUDED.source, title = EXCLUDED.title, url = EXCLUDED.url, score = EXCLUDED.score, collected_at = EXCLUDED.collected_at, payload = EXCLUDED.payload`,
        [signalKey, signal.source, signal.title, signal.url, signal.score, signal.collectedAt, JSON.stringify(signal)],
      );
      await connection.query(
        "INSERT INTO radar_observations (signal_key, observed_at, metric) VALUES ($1, $2::timestamptz, $3)",
        [signalKey, signal.collectedAt, signal.observedMetric],
      );
    }
    await connection.query(
      "INSERT INTO radar_runs (id, started_at, finished_at, trigger, sources, classified) VALUES ($1, $2, $3, $4, $5::jsonb, $6)",
      [run.id, run.startedAt, run.finishedAt, run.trigger, JSON.stringify(run.sources), run.classified],
    );
    await connection.query("COMMIT");
    return { persisted: true as const, count: signals.length };
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

export async function recordRadarRun(run: RadarRunWrite) {
  const client = getNeonPool();
  if (!client) throw new Error("Neon indisponível: o Radar real precisa do banco configurado.");
  await client.query(
    "INSERT INTO radar_runs (id, started_at, finished_at, trigger, sources, classified) VALUES ($1, $2, $3, $4, $5::jsonb, $6)",
    [run.id, run.startedAt, run.finishedAt, run.trigger, JSON.stringify(run.sources), run.classified],
  );
}

export async function readRadarSignals(days = 21): Promise<{ signals: any[]; sources: any[]; lastRun: any | null; persisted: boolean }> {
  const client = getNeonPool();
  if (!client) return { signals: [], sources: [], lastRun: null, persisted: false };
  const [signals, runs] = await Promise.all([
    client.query<{ payload: Record<string, unknown> }>("SELECT payload FROM radar_signals WHERE collected_at >= NOW() - ($1::int * INTERVAL '1 day') ORDER BY score DESC, collected_at DESC LIMIT 150", [days]),
    client.query<{ id: string; started_at: Date; finished_at: Date; trigger: string; sources: any; classified: number }>("SELECT id, started_at, finished_at, trigger, sources, classified FROM radar_runs ORDER BY finished_at DESC LIMIT 1"),
  ]);
  const latest = runs.rows[0];
  return {
    signals: signals.rows.map(row => row.payload),
    sources: latest?.sources ?? [],
    lastRun: latest ? { id: latest.id, startedAt: new Date(latest.started_at).toISOString(), finishedAt: new Date(latest.finished_at).toISOString(), trigger: latest.trigger, classified: Number(latest.classified) } : null,
    persisted: true,
  };
}
