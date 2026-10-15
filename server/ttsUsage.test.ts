import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("./studioRepository", () => ({ getStudioPool: () => ({ query }) }));

import { recordTtsCacheHit } from "./ttsUsage";

describe("TTS usage events", () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
  });

  it("stores the purpose of a cached sample in the cache_hit row", async () => {
    await recordTtsCacheHit("gemini-3.8-flash-tts", "connection_test");

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("'cache_hit'");
    expect(sql).toContain("$3");
    expect(values[1]).toBe("gemini-3.8-flash-tts");
    expect(values[2]).toBe("connection_test");
  });
});
