import { afterEach, describe, expect, it, vi } from "vitest";
import { hashOwnerPassword, verifyOwnerPassword } from "./auth";

afterEach(() => vi.unstubAllEnvs());

describe("owner authentication", () => {
  it("generates a scrypt hash that verifies only the original password", async () => {
    const hash = await hashOwnerPassword("senha-de-teste-com-mais-de-12");
    vi.stubEnv("STUDIO_OWNER_EMAIL", "dono@example.com");
    vi.stubEnv("STUDIO_OWNER_PASSWORD_HASH", hash);
    expect(await verifyOwnerPassword("senha-de-teste-com-mais-de-12")).toBe(true);
    expect(await verifyOwnerPassword("senha-errada-com-mais-de-12")).toBe(false);
  });
});
