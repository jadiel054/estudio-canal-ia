import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  completeWithFallback: vi.fn(),
  getRadarBaselines: vi.fn(),
  persistRadarBatch: vi.fn(),
  recordRadarRun: vi.fn(),
  readRadarSignals: vi.fn(),
  appendStudioAudit: vi.fn(),
}));
vi.mock("./llmProviders", () => ({ completeWithFallback: mocked.completeWithFallback }));
vi.mock("./studioRepository", () => mocked);

import { baselineScores, collectDevTo, collectGitHub, collectHackerNews, refreshRadar } from "./radar";

function response(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }); }

beforeEach(() => {
  vi.restoreAllMocks();
  mocked.completeWithFallback.mockReset();
  mocked.getRadarBaselines.mockReset().mockResolvedValue(new Map());
  mocked.persistRadarBatch.mockReset().mockResolvedValue({ persisted: true, count: 3 });
  mocked.recordRadarRun.mockReset();
  mocked.readRadarSignals.mockReset();
  mocked.appendStudioAudit.mockReset().mockResolvedValue({ persisted: true });
});

describe("Radar · fontes públicas", () => {
  it("lê histórias HN e ignora itens sem relevância técnica", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/topstories.json")) return response([1, 2]);
      if (url.includes("/item/1.json")) return response({ id: 1, type: "story", title: "Build an MCP server with TypeScript", text: "A developer tool", score: 12, descendants: 3, time: 1_800_000_000, url: "https://example.org/mcp" });
      return response({ id: 2, type: "story", title: "A celebrity news item", score: 400, time: 1_800_000_000 });
    }));
    const items = await collectHackerNews();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "Hacker News", externalId: "1", metric: 12, comments: 3 });
  });

  it("deduplica repositórios que coincidem com mais de um termo GitHub", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ items: [{ id: 42, full_name: "sample/mcp-agent", description: "AI agent", html_url: "https://github.com/sample/mcp-agent", created_at: "2026-10-12T00:00:00Z", stargazers_count: 20, forks_count: 4, language: "TypeScript", topics: ["mcp"] }] })));
    const items = await collectGitHub();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "GitHub", externalId: "42", metric: 20, language: "TypeScript" });
  });

  it("deduplica artigos dev.to encontrados por várias tags", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([{ id: 9, title: "Build MCP tools with Python", description: "A developer tutorial", url: "https://dev.to/author/mcp", published_at: "2026-10-12T00:00:00Z", tag_list: ["ai", "python"], positive_reactions_count: 6, comments_count: 2 }])));
    const items = await collectDevTo();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "dev.to", externalId: "9", metric: 6, comments: 2 });
  });
});

describe("Radar · score, crescimento e persistência", () => {
  it("marca a primeira observação como estimativa, sem inventar histórico", () => {
    const result = baselineScores({ source: "GitHub", externalId: "x", title: "MCP", description: "", url: "https://example.org", publishedAt: new Date().toISOString(), tags: [], metric: 7, comments: 2 });
    expect(result.growthPct).toBeNull();
    expect(result.growth).toContain("estimado");
    expect(result.volumeScore).toBeGreaterThan(0);
  });

  it("calcula variação somente contra snapshot anterior", () => {
    const candidate = { source: "GitHub" as const, externalId: "x", title: "MCP", description: "", url: "https://example.org", publishedAt: "2026-10-12T00:00:00Z", tags: [], metric: 15, comments: 1 };
    const result = baselineScores(candidate, { metric: 10, observedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    expect(result.growthPct).toBe(60);
    expect(result.growth).toContain("+60%");
  });

  it("persiste resultados reais e marca classificação LLM", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/topstories.json")) return response([1, 2]);
      if (url.includes("/item/1.json")) return response({ id: 1, type: "story", title: "Build an MCP server with TypeScript", score: 12, descendants: 3, time: 1_800_000_000, url: "https://example.org/mcp" });
      if (url.includes("/item/2.json")) return response({ id: 2, type: "story", title: "A celebrity news item", score: 400, time: 1_800_000_000 });
      if (url.includes("api.github.com")) return response({ items: [{ id: 42, full_name: "sample/mcp-agent", description: "AI agent", html_url: "https://github.com/sample/mcp-agent", created_at: "2026-10-12T00:00:00Z", stargazers_count: 20, forks_count: 4, language: "TypeScript", topics: ["mcp"] }] });
      return response([{ id: 9, title: "Build MCP tools with Python", description: "A developer tutorial", url: "https://dev.to/author/mcp", published_at: "2026-10-12T00:00:00Z", tag_list: ["ai", "python"], positive_reactions_count: 6, comments_count: 2 }]);
    }));
    mocked.completeWithFallback.mockResolvedValue({ provider: "groq", model: "test-model", text: JSON.stringify({ items: [0, 1, 2].map(index => ({ index, fit: 80, gap: 70, fitReason: "Ferramenta de dev", gapReason: "Metadados sem PT-BR", angle: "Reproduzir em projeto real", tags: ["MCP"] })) }) });
    const result = await refreshRadar("Sistema", "cron");
    expect(result.total).toBe(3);
    expect(result.classifiedByLLM).toBe(3);
    expect(result.signals.every(signal => signal.score >= 0 && signal.score <= 100)).toBe(true);
    expect(mocked.persistRadarBatch).toHaveBeenCalledTimes(1);
    expect(mocked.appendStudioAudit).toHaveBeenCalledTimes(1);
  });
});
