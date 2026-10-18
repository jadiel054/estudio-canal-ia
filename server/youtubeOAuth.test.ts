import { afterEach, describe, expect, it, vi } from "vitest";
import { handleYouTubeOAuthCallback, startYouTubeOAuth, YOUTUBE_ANALYTICS_READONLY_SCOPE, YOUTUBE_OAUTH_REDIRECT_URI, YOUTUBE_READONLY_SCOPE, YouTubeOAuthError } from "./youtubeOAuth";

function poolForStart() {
  return { query: vi.fn(async () => ({ rows: [], rowCount: 1 })), connect: vi.fn() } as any;
}

afterEach(() => vi.unstubAllEnvs());

describe("OAuth YouTube read-only", () => {
  it("cria state hash com TTL e URL sem escopo de escrita", async () => {
    vi.stubEnv("YOUTUBE_CLIENT_ID", "client-id");
    const pool = poolForStart();
    const result = await startYouTubeOAuth("owner:one", "default", { pool, now: () => new Date("2026-01-01T00:00:00Z") });
    const url = new URL(result.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(YOUTUBE_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe(`${YOUTUBE_READONLY_SCOPE} ${YOUTUBE_ANALYTICS_READONLY_SCOPE}`);
    expect(url.searchParams.get("scope")).not.toContain("youtube.upload");
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(result.expiresAt.toISOString()).toBe("2026-01-01T00:10:00.000Z");
  });

  it("valida state, troca code, descobre um canal e persiste tokens cifrados", async () => {
    vi.stubEnv("YOUTUBE_CLIENT_ID", "client-id");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("YOUTUBE_OAUTH_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const state = "state-from-provider";
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ owner_id: "owner:one", workspace_id: "default", redirect_uri: YOUTUBE_OAUTH_REDIRECT_URI }] })
      .mockResolvedValueOnce({ rows: [{ id: "channel-db-id" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }), release: vi.fn() };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) } as any;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", scope: `${YOUTUBE_READONLY_SCOPE} ${YOUTUBE_ANALYTICS_READONLY_SCOPE}`, expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "UC123", snippet: { title: "Canal real" } }] }), { status: 200 }));
    const result = await handleYouTubeOAuthCallback({ code: "code", state }, undefined, { pool, fetcher });
    expect(result).toMatchObject({ ownerId: "owner:one", channelId: "channel-db-id", channelName: "Canal real" });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("consumed_at"), expect.any(Array));
    const credentialInsert = client.query.mock.calls.find((call: any[]) => String(call[0]).includes("youtube_oauth_credentials"));
    expect(credentialInsert?.[1]).not.toContain("access");
    expect(credentialInsert?.[1]).not.toContain("refresh");
    expect(client.release).toHaveBeenCalled();
  });

  it("falha fechado para state ausente/reutilizado e scope de escrita", async () => {
    await expect(handleYouTubeOAuthCallback({ code: "code" }, undefined, { pool: poolForStart(), fetcher: vi.fn() })).rejects.toMatchObject({ code: "youtube_callback_missing_parameters" });
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }), release: vi.fn() };
    await expect(handleYouTubeOAuthCallback({ code: "code", state: "used" }, undefined, { pool: { connect: vi.fn(async () => client) } as any })).rejects.toMatchObject({ code: "youtube_state_invalid" });
  });

  it("rejeita callback que retorna somente um dos dois escopos", async () => {
    vi.stubEnv("YOUTUBE_CLIENT_ID", "client-id");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "client-secret");
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ owner_id: "owner:one", workspace_id: "default", redirect_uri: YOUTUBE_OAUTH_REDIRECT_URI }] }), release: vi.fn() };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", scope: YOUTUBE_READONLY_SCOPE, expires_in: 3600 }), { status: 200 }));
    await expect(handleYouTubeOAuthCallback({ code: "code", state: "state" }, undefined, { pool: { connect: vi.fn(async () => client) } as any, fetcher })).rejects.toMatchObject({ code: "youtube_scope_rejected" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalled();
  });

  it("usa somente códigos sanitizados para falha do OAuth", () => {
    expect(new YouTubeOAuthError("youtube_scope_rejected").message).toBe("youtube_scope_rejected");
  });
});
