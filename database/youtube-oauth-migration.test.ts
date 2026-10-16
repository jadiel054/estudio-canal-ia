import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration OAuth YouTube", () => {
  it("mantém o schema aditivo e read-only sem segredo ou execução externa", () => {
    const sql = readFileSync(resolve(process.cwd(), "database/youtube-oauth-migration.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS oauth_connection_states");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS youtube_oauth_credentials");
    expect(sql).toContain("channels_owner_workspace_platform_external_uidx");
    expect(sql).toContain("refresh_token_ciphertext BYTEA NOT NULL");
    expect(sql).toContain("CHECK (provider IN ('youtube'))");
    expect(sql).toContain("CHECK (platform IN ('youtube', 'tiktok'))");
    expect(sql).not.toMatch(/youtube\.upload/i);
    expect(sql).not.toMatch(/https?:\/\//i);
  });
});
