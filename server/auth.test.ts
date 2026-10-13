import { afterEach, describe, expect, it, vi } from "vitest";
import { hashOwnerPassword, sessionVersionMatches, verifyOwnerPassword } from "./auth";
import { authRatePolicy } from "./studioRepository";

afterEach(() => vi.unstubAllEnvs());

describe("owner authentication", () => {
  it("generates a scrypt hash that verifies only the original password", async () => {
    const hash = await hashOwnerPassword("senha-de-teste-com-mais-de-12");
    vi.stubEnv("STUDIO_OWNER_EMAIL", "dono@example.com");
    vi.stubEnv("STUDIO_OWNER_PASSWORD_HASH", hash);
    expect(await verifyOwnerPassword("senha-de-teste-com-mais-de-12")).toBe(true);
    expect(await verifyOwnerPassword("senha-errada-com-mais-de-12")).toBe(false);
  });
  it("rejects a JWT claim from a previous password version", () => {
    expect(sessionVersionMatches(4, 4)).toBe(true);
    expect(sessionVersionMatches(3, 4)).toBe(false);
  });
  it("does not let the global limiter lock the owner after five failures", () => {
    expect(authRatePolicy("auth:global")).toEqual({ maxFailures: 50, maxBlockMinutes: 10 });
    expect(authRatePolicy("auth:ip:203.0.113.10")).toEqual({ maxFailures: 20, maxBlockMinutes: 60 });
  });
});
