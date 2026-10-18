import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getStudioPool } from "./studioRepository";

export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
const REQUIRED_READONLY_SCOPES = [YOUTUBE_READONLY_SCOPE, YOUTUBE_ANALYTICS_READONLY_SCOPE] as const;
export const YOUTUBE_OAUTH_REDIRECT_URI = "https://estudio-canal-ia.vercel.app/api/integrations/youtube/callback";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
const STATE_TTL_MS = 10 * 60 * 1000;

type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> };
type DbClient = Queryable & { release(): void };
type DbPool = Queryable & { connect(): Promise<DbClient> };
type OAuthDeps = { pool?: DbPool; fetcher?: typeof fetch; now?: () => Date };

export class YouTubeOAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "YouTubeOAuthError";
  }
}

function poolFromEnv(): DbPool {
  const pool = getStudioPool() as unknown as DbPool | undefined;
  if (!pool) throw new YouTubeOAuthError("youtube_storage_unavailable");
  return pool;
}
function clientId() { const value = process.env.YOUTUBE_CLIENT_ID?.trim(); if (!value) throw new YouTubeOAuthError("youtube_not_configured"); return value; }
function clientSecret() { const value = process.env.YOUTUBE_CLIENT_SECRET?.trim(); if (!value) throw new YouTubeOAuthError("youtube_not_configured"); return value; }
function encryptionKey() {
  const value = process.env.YOUTUBE_OAUTH_ENCRYPTION_KEY?.trim() ?? "";
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new YouTubeOAuthError("youtube_encryption_not_configured");
  return key;
}
function keyVersion() { return (process.env.YOUTUBE_OAUTH_ENCRYPTION_KEY_VERSION?.trim() || "v1").slice(0, 40); }
function stateHash(state: string) { return createHash("sha256").update(state, "utf8").digest("hex"); }
function safeChannelName(value: unknown) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : "Canal YouTube"; }
function scopesFrom(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.filter(item => typeof item === "string") : typeof value === "string" ? value.split(/\s+/) : [];
  return [...new Set(raw.map(item => item.trim()).filter(Boolean))];
}
function assertReadOnlyScopes(scopes: string[]) {
  if (scopes.length !== REQUIRED_READONLY_SCOPES.length || REQUIRED_READONLY_SCOPES.some(scope => !scopes.includes(scope))) throw new YouTubeOAuthError("youtube_scope_rejected");
}
function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}
function open(ciphertext: Uint8Array, iv: Uint8Array, tag: Uint8Array) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv));
    decipher.setAuthTag(Buffer.from(tag));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString("utf8");
  } catch { throw new YouTubeOAuthError("youtube_token_unreadable"); }
}
function configuredFetcher(deps?: OAuthDeps) { return deps?.fetcher ?? fetch; }
function validExpires(value: unknown): Date | undefined { const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : undefined; return date && Number.isFinite(date.getTime()) ? date : undefined; }

export async function startYouTubeOAuth(ownerId: string, workspaceId = "default", deps: OAuthDeps = {}) {
  const configuredClientId = clientId();
  const pool = deps.pool ?? poolFromEnv();
  const state = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date((deps.now?.() ?? new Date()).getTime() + STATE_TTL_MS);
  await pool.query("DELETE FROM oauth_connection_states WHERE provider = 'youtube' AND (expires_at <= NOW() OR consumed_at IS NOT NULL)");
  await pool.query(
    "INSERT INTO oauth_connection_states (id, owner_id, workspace_id, provider, state_hash, redirect_uri, expires_at) VALUES ($1::uuid, $2, $3, 'youtube', $4, $5, $6)",
    [id, ownerId, workspaceId, stateHash(state), YOUTUBE_OAUTH_REDIRECT_URI, expiresAt.toISOString()]
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", configuredClientId);
  url.searchParams.set("redirect_uri", YOUTUBE_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", REQUIRED_READONLY_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return { url: url.toString(), expiresAt };
}

async function exchangeCode(code: string, fetcher: typeof fetch) {
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: YOUTUBE_OAUTH_REDIRECT_URI, grant_type: "authorization_code" }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  let body: any = {};
  try { body = await response.json(); } catch { /* resposta sanitizada */ }
  if (!response.ok || typeof body.access_token !== "string") throw new YouTubeOAuthError(body.error === "invalid_grant" ? "youtube_code_rejected" : "youtube_token_exchange_failed");
  const scopes = scopesFrom(body.scope);
  assertReadOnlyScopes(scopes);
  if (typeof body.refresh_token !== "string" || !body.refresh_token) throw new YouTubeOAuthError("youtube_refresh_token_missing");
  return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string, scopes, expiresIn: Number.isFinite(Number(body.expires_in)) ? Math.max(60, Number(body.expires_in)) : 3_600 };
}

async function discoverChannel(accessToken: string, fetcher: typeof fetch) {
  const url = new URL(YOUTUBE_CHANNELS_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  const response = await fetcher(url, { headers: { accept: "application/json", authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  let body: any = {};
  try { body = await response.json(); } catch { /* resposta sanitizada */ }
  if (!response.ok) throw new YouTubeOAuthError("youtube_channel_lookup_failed");
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new YouTubeOAuthError("youtube_channel_not_found");
  if (items.length > 1) throw new YouTubeOAuthError("youtube_multiple_channels");
  const item = items[0];
  if (!item || typeof item.id !== "string" || !item.id || item.id.length > 200) throw new YouTubeOAuthError("youtube_channel_invalid");
  return { externalId: item.id, name: safeChannelName(item.snippet?.title) };
}

export async function handleYouTubeOAuthCallback(params: { code?: string; state?: string; error?: string }, ownerFallback?: { ownerId: string; workspaceId?: string }, deps: OAuthDeps = {}) {
  if (params.error) throw new YouTubeOAuthError("youtube_consent_denied");
  if (!params.code || !params.state) throw new YouTubeOAuthError("youtube_callback_missing_parameters");
  const pool = deps.pool ?? poolFromEnv();
  const fetcher = configuredFetcher(deps);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stateResult = await client.query<{ owner_id: string; workspace_id: string; redirect_uri: string }>(
      "UPDATE oauth_connection_states SET consumed_at = NOW() WHERE state_hash = $1 AND provider = 'youtube' AND consumed_at IS NULL AND expires_at > NOW() RETURNING owner_id, workspace_id, redirect_uri",
      [stateHash(params.state)]
    );
    const state = stateResult.rows[0];
    if (!state || state.redirect_uri !== YOUTUBE_OAUTH_REDIRECT_URI) throw new YouTubeOAuthError("youtube_state_invalid");
    if (ownerFallback && (ownerFallback.ownerId !== state.owner_id || (ownerFallback.workspaceId ?? "default") !== state.workspace_id)) throw new YouTubeOAuthError("youtube_owner_mismatch");
    const token = await exchangeCode(params.code, fetcher);
    const channel = await discoverChannel(token.accessToken, fetcher);
    const refresh = seal(token.refreshToken);
    const access = seal(token.accessToken);
    const channelResult = await client.query<{ id: string }>(
      `INSERT INTO channels (name, platform, external_channel_id, status, owner_id, workspace_id, connected_at, last_synced_at, revoked_at, last_error)
       VALUES ($1, 'youtube', $2, 'connected', $3, $4, NOW(), NOW(), NULL, NULL)
       ON CONFLICT (owner_id, workspace_id, platform, external_channel_id) WHERE external_channel_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, status = 'connected', connected_at = NOW(), last_synced_at = NOW(), revoked_at = NULL, last_error = NULL
       RETURNING id`,
      [channel.name, channel.externalId, state.owner_id, state.workspace_id]
    );
    const channelId = channelResult.rows[0]?.id;
    if (!channelId) throw new YouTubeOAuthError("youtube_channel_persist_failed");
    await client.query(
      `INSERT INTO youtube_oauth_credentials (id, owner_id, workspace_id, channel_id, scopes, access_token_ciphertext, access_token_iv, access_token_tag, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag, key_version, access_token_expires_at, connected_at, updated_at, revoked_at)
       VALUES ($1::uuid, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, NOW() + ($13::int * INTERVAL '1 second'), NOW(), NOW(), NULL)
       ON CONFLICT (owner_id, workspace_id, channel_id)
       DO UPDATE SET scopes = EXCLUDED.scopes, access_token_ciphertext = EXCLUDED.access_token_ciphertext, access_token_iv = EXCLUDED.access_token_iv, access_token_tag = EXCLUDED.access_token_tag, refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext, refresh_token_iv = EXCLUDED.refresh_token_iv, refresh_token_tag = EXCLUDED.refresh_token_tag, key_version = EXCLUDED.key_version, access_token_expires_at = EXCLUDED.access_token_expires_at, updated_at = NOW(), revoked_at = NULL`,
      [randomUUID(), state.owner_id, state.workspace_id, channelId, token.scopes, access.ciphertext, access.iv, access.tag, refresh.ciphertext, refresh.iv, refresh.tag, keyVersion(), token.expiresIn]
    );
    await client.query("COMMIT");
    return { ownerId: state.owner_id, workspaceId: state.workspace_id, channelId, channelName: channel.name };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* sem segredo */ }
    throw error instanceof YouTubeOAuthError ? error : new YouTubeOAuthError("youtube_connection_failed");
  } finally { client.release(); }
}

export async function getYouTubeConnectionStatus(ownerId: string, workspaceId = "default", deps: OAuthDeps = {}) {
  const pool = deps.pool ?? poolFromEnv();
  const result = await pool.query<{ name: string; status: string; connected_at: Date | null; last_synced_at: Date | null; revoked_at: Date | null; last_error: string | null }>(
    `SELECT c.name, c.status, c.connected_at, c.last_synced_at, c.revoked_at, c.last_error
       FROM channels c JOIN youtube_oauth_credentials y ON y.channel_id = c.id
      WHERE c.owner_id = $1 AND c.workspace_id = $2 AND c.platform = 'youtube' AND y.revoked_at IS NULL
      ORDER BY c.connected_at DESC LIMIT 1`, [ownerId, workspaceId]
  );
  const row = result.rows[0];
  return row ? { connected: row.status === "connected", status: row.status === "connected" ? "connected" as const : "error" as const, channelName: row.name, connectedAt: row.connected_at, lastSyncedAt: row.last_synced_at, error: row.last_error ? "connection_error" : null } : { connected: false, status: "not_connected" as const, channelName: null, connectedAt: null, lastSyncedAt: null, error: null };
}

export async function revokeYouTubeConnection(ownerId: string, workspaceId = "default", deps: OAuthDeps = {}) {
  const pool = deps.pool ?? poolFromEnv();
  const fetcher = configuredFetcher(deps);
  const result = await pool.query<{ id: string; refresh_token_ciphertext: Uint8Array; refresh_token_iv: Uint8Array; refresh_token_tag: Uint8Array }>(
    `SELECT y.id, y.refresh_token_ciphertext, y.refresh_token_iv, y.refresh_token_tag FROM youtube_oauth_credentials y WHERE y.owner_id = $1 AND y.workspace_id = $2 AND y.revoked_at IS NULL ORDER BY y.updated_at DESC LIMIT 1`, [ownerId, workspaceId]
  );
  const row = result.rows[0];
  if (row) {
    try {
      const token = open(row.refresh_token_ciphertext, row.refresh_token_iv, row.refresh_token_tag);
      await fetcher(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
    } catch { /* revogação local continua idempotente */ }
  }
  await pool.query(
    `UPDATE youtube_oauth_credentials SET revoked_at = NOW(), access_token_ciphertext = NULL, refresh_token_ciphertext = decode('', 'hex'), updated_at = NOW() WHERE owner_id = $1 AND workspace_id = $2 AND revoked_at IS NULL`, [ownerId, workspaceId]
  );
  await pool.query(
    `UPDATE channels SET status = 'not_connected', revoked_at = NOW(), last_error = NULL WHERE owner_id = $1 AND workspace_id = $2 AND platform = 'youtube'`, [ownerId, workspaceId]
  );
  return { revoked: true } as const;
}

export async function refreshYouTubeAccessToken(ownerId: string, workspaceId = "default", deps: OAuthDeps = {}) {
  const pool = deps.pool ?? poolFromEnv();
  const fetcher = configuredFetcher(deps);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`youtube-oauth:${ownerId}:${workspaceId}`]);
    const result = await client.query<{ id: string; access_token_ciphertext: Uint8Array | null; access_token_iv: Uint8Array | null; access_token_tag: Uint8Array | null; refresh_token_ciphertext: Uint8Array; refresh_token_iv: Uint8Array; refresh_token_tag: Uint8Array; access_token_expires_at: Date | null }>(
      `SELECT id, access_token_ciphertext, access_token_iv, access_token_tag, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag, access_token_expires_at FROM youtube_oauth_credentials WHERE owner_id = $1 AND workspace_id = $2 AND revoked_at IS NULL LIMIT 1 FOR UPDATE`, [ownerId, workspaceId]
    );
    const row = result.rows[0];
    if (!row) throw new YouTubeOAuthError("youtube_not_connected");
    const expiresAt = validExpires(row.access_token_expires_at);
    if (row.access_token_ciphertext && row.access_token_iv && row.access_token_tag && expiresAt && expiresAt.getTime() > Date.now() + 60_000) {
      const accessToken = open(row.access_token_ciphertext, row.access_token_iv, row.access_token_tag);
      await client.query("COMMIT");
      return accessToken;
    }
    const refreshToken = open(row.refresh_token_ciphertext, row.refresh_token_iv, row.refresh_token_tag);
    const response = await fetcher(GOOGLE_TOKEN_URL, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), refresh_token: refreshToken, grant_type: "refresh_token" }).toString(), signal: AbortSignal.timeout(15_000) });
    let body: any = {}; try { body = await response.json(); } catch { /* sanitizado */ }
    if (!response.ok || typeof body.access_token !== "string") { if (body.error === "invalid_grant") { await client.query("UPDATE youtube_oauth_credentials SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1::uuid", [row.id]); await client.query("COMMIT"); throw new YouTubeOAuthError("youtube_reconnect_required"); } throw new YouTubeOAuthError("youtube_refresh_failed"); }
    const access = seal(body.access_token);
    const expiresIn = Number.isFinite(Number(body.expires_in)) ? Math.max(60, Number(body.expires_in)) : 3_600;
    await client.query("UPDATE youtube_oauth_credentials SET access_token_ciphertext = $2, access_token_iv = $3, access_token_tag = $4, access_token_expires_at = NOW() + ($5::int * INTERVAL '1 second'), updated_at = NOW() WHERE id = $1::uuid", [row.id, access.ciphertext, access.iv, access.tag, expiresIn]);
    await client.query("COMMIT");
    return body.access_token as string;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* sem segredo */ }
    throw error instanceof YouTubeOAuthError ? error : new YouTubeOAuthError("youtube_refresh_failed");
  } finally { client.release(); }
}
