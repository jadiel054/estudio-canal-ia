import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("configuração Vercel do app Express", () => {
  it("mantém a função única, o build estático e os rewrites de render e integrações", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      framework?: string | null;
      outputDirectory?: string;
      functions?: Record<string, unknown>;
      rewrites?: Array<{ source?: string; destination?: string }>;
    };
    expect(config.framework).toBeNull();
    expect(config.outputDirectory).toBe("public");
    expect(config.functions?.["api/**/*.js"]).toBeTruthy();
    expect(config.rewrites).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "/api/render/download/:jobId", destination: "/api/render?delivery=download&jobId=:jobId" }),
      expect.objectContaining({ source: "/api/render/preview/:jobId", destination: "/api/render?delivery=preview&jobId=:jobId" }),
      expect.objectContaining({ source: "/api/integrations/:path*", destination: "/api/integrations" }),
    ]));
  });

  it("mantém o adapter flat de integrações", () => {
    const adapter = readFileSync(resolve(process.cwd(), "api/integrations.js"), "utf8");
    expect(adapter).toContain('from "../dist/server.mjs"');
    expect(adapter).toContain("export { default }");
  });
});
