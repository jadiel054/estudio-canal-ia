import { Pool } from "pg";

export type AuditWrite = {
  actor: "Você" | "Nexo" | "Sistema";
  action: string;
  target: string;
  details?: Record<string, unknown>;
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
