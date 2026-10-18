import { getStudioPool } from "./studioRepository";
import { refreshYouTubeAccessToken } from "./youtubeOAuth";

export const YOUTUBE_ANALYTICS_PROBE_METRICS = [
  "views",
  "averageViewPercentage",
  "averageViewDuration",
  "subscribersGained",
  "subscribersLost",
] as const;

export type YouTubeAnalyticsProbeStatus = "ok" | "auth_insufficient" | "quota_exceeded" | "not_ready" | "network_error";

export type YouTubeAnalyticsProbeResult = {
  status: YouTubeAnalyticsProbeStatus;
  rowCount: number;
  nonNullMetrics: string[];
};

type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };
type TokenDeps = { fetcher?: typeof fetch };
type ProbeDeps = {
  pool?: Queryable;
  fetcher?: typeof fetch;
  now?: () => Date;
  tokenProvider?: (ownerId: string, workspaceId: string, deps: TokenDeps) => Promise<string>;
};

type ConnectedChannel = { id: string; external_channel_id: string | null };
type AnalyticsResponse = { columnHeaders?: Array<{ name?: unknown }>; rows?: unknown[][] };

const ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const WORKSPACE_ID = "default";

function poolFromEnv(): Queryable | undefined {
  return getStudioPool() as unknown as Queryable | undefined;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function probeWindow(now: Date) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { startDate: dateOnly(start), endDate: dateOnly(end) };
}

function result(status: YouTubeAnalyticsProbeStatus, rowCount = 0, nonNullMetrics: string[] = []): YouTubeAnalyticsProbeResult {
  return { status, rowCount, nonNullMetrics };
}

function classifyRefreshFailure(error: unknown): YouTubeAnalyticsProbeStatus {
  const code = error instanceof Error ? error.message : "";
  if (code === "youtube_reconnect_required" || code === "youtube_token_unreadable") return "auth_insufficient";
  if (code === "youtube_not_connected") return "not_ready";
  return "network_error";
}

function summarizeResponse(body: AnalyticsResponse): YouTubeAnalyticsProbeResult {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.columnHeaders) ? body.columnHeaders : [];
  const headerNames = headers.map(header => (typeof header?.name === "string" ? header.name : ""));
  const nonNullMetrics = YOUTUBE_ANALYTICS_PROBE_METRICS.filter(metric => {
    const index = headerNames.indexOf(metric);
    return index >= 0 && rows.some(row => Array.isArray(row) && row[index] !== null && row[index] !== undefined && row[index] !== "");
  });
  return result("ok", rows.length, [...nonNullMetrics]);
}

export async function probeYouTubeAnalytics(ownerId: string, workspaceId = WORKSPACE_ID, deps: ProbeDeps = {}): Promise<YouTubeAnalyticsProbeResult> {
  const pool = deps.pool ?? poolFromEnv();
  if (!pool) return result("not_ready");

  let channel: ConnectedChannel | undefined;
  try {
    const channelResult = await pool.query<ConnectedChannel>(
      `SELECT c.id, c.external_channel_id
         FROM channels c
         JOIN youtube_oauth_credentials y ON y.channel_id = c.id
        WHERE c.owner_id = $1 AND c.workspace_id = $2 AND c.platform = 'youtube'
          AND c.status = 'connected' AND c.external_channel_id IS NOT NULL AND y.revoked_at IS NULL
        ORDER BY y.updated_at DESC LIMIT 1`,
      [ownerId, workspaceId],
    );
    channel = channelResult.rows[0];
  } catch {
    return result("not_ready");
  }
  if (!channel?.external_channel_id) return result("not_ready");

  const fetcher = deps.fetcher ?? fetch;
  let accessToken: string;
  try {
    accessToken = await (deps.tokenProvider ?? refreshYouTubeAccessToken)(ownerId, workspaceId, { fetcher });
  } catch (error) {
    return result(classifyRefreshFailure(error));
  }

  const { startDate, endDate } = probeWindow(deps.now?.() ?? new Date());
  const url = new URL(ANALYTICS_URL);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("dimensions", "day,video");
  url.searchParams.set("metrics", YOUTUBE_ANALYTICS_PROBE_METRICS.join(","));
  url.searchParams.set("filters", `channel==${channel.external_channel_id}`);

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return result("network_error");
  }

  if (response.status === 401 || response.status === 403) return result("auth_insufficient");
  if (response.status === 429) return result("quota_exceeded");
  if (!response.ok) return result("not_ready");

  try {
    return summarizeResponse((await response.json()) as AnalyticsResponse);
  } catch {
    return result("network_error");
  }
}
