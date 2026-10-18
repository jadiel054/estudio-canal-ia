import { afterEach, describe, expect, it, vi } from "vitest";
import { probeYouTubeAnalytics } from "./youtubeAnalyticsProbe";

const NOW = new Date("2026-10-17T12:00:00.000Z");

function poolWithChannel(externalChannelId = "UC123") {
  return { query: vi.fn(async () => ({ rows: [{ id: "channel-db-id", external_channel_id: externalChannelId }] })) } as any;
}

function deps(fetcher: typeof fetch, pool = poolWithChannel()) {
  return {
    pool,
    fetcher,
    now: () => NOW,
    tokenProvider: vi.fn(async () => "ephemeral-access-token"),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("probe efêmera do YouTube Analytics", () => {
  it("retorna somente resumo allowlisted e envia janela, channel e métricas corretos", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      columnHeaders: [
        { name: "day" },
        { name: "video" },
        { name: "views" },
        { name: "averageViewPercentage" },
        { name: "averageViewDuration" },
        { name: "subscribersGained" },
        { name: "subscribersLost" },
      ],
      rows: [["2026-10-10", "video-opaque", 12, 44.2, null, 1, 0]],
    }), { status: 200 }));

    const result = await probeYouTubeAnalytics("owner:one", "default", deps(fetcher));
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];

    expect(result).toEqual({ status: "ok", rowCount: 1, nonNullMetrics: ["views", "averageViewPercentage", "subscribersGained", "subscribersLost"] });
    expect(url.searchParams.get("ids")).toBe("channel==MINE");
    expect(url.searchParams.get("filters")).toBe("channel==UC123");
    expect(url.searchParams.get("startDate")).toBe("2026-10-10");
    expect(url.searchParams.get("endDate")).toBe("2026-10-16");
    expect(url.searchParams.get("dimensions")).toBe("day,video");
    expect(url.searchParams.get("metrics")).toBe("views,averageViewPercentage,averageViewDuration,subscribersGained,subscribersLost");
    expect(options.headers).toEqual({ accept: "application/json", authorization: "Bearer ephemeral-access-token" });
    expect(JSON.stringify(result)).not.toContain("video-opaque");
  });

  it("classifica 401/403 como auth_insufficient", async () => {
    for (const status of [401, 403]) {
      const fetcher = vi.fn(async () => new Response("", { status }));
      await expect(probeYouTubeAnalytics("owner:one", "default", deps(fetcher))).resolves.toEqual({ status: "auth_insufficient", rowCount: 0, nonNullMetrics: [] });
    }
  });

  it("classifica 429 como quota_exceeded", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 429 }));
    await expect(probeYouTubeAnalytics("owner:one", "default", deps(fetcher))).resolves.toEqual({ status: "quota_exceeded", rowCount: 0, nonNullMetrics: [] });
  });

  it("classifica canal ausente como not_ready sem chamar o provider", async () => {
    const fetcher = vi.fn();
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as any;
    await expect(probeYouTubeAnalytics("owner:one", "default", deps(fetcher, pool))).resolves.toEqual({ status: "not_ready", rowCount: 0, nonNullMetrics: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("classifica falha de rede como network_error sem vazar erro bruto", async () => {
    const fetcher = vi.fn(async () => { throw new Error("segredo do provider"); });
    const result = await probeYouTubeAnalytics("owner:one", "default", deps(fetcher));
    expect(result).toEqual({ status: "network_error", rowCount: 0, nonNullMetrics: [] });
    expect(JSON.stringify(result)).not.toContain("segredo");
  });
});
