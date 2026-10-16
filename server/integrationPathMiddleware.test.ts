import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreYouTubeIntegrationPath } from "./app";
import http from "node:http";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function request(path: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const app = express();
    app.use(restoreYouTubeIntegrationPath);
    app.get("/api/integrations/youtube/start", (req, res) => res.status(418).send(req.url));
    app.use((_req, res) => res.status(404).send("not-found"));
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("server address unavailable"));
      http.get({ hostname: "127.0.0.1", port: address.port, path }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      }).on("error", reject);
    });
  });
}

describe("middleware de caminho das integrações YouTube", () => {
  it("restaura segmentos e preserva query própria até a rota Express", async () => {
    await expect(request("/api/integrations?__segments=youtube%2Fstart&code=abc&state=xyz"))
      .resolves.toEqual({ status: 418, body: "/api/integrations/youtube/start?code=abc&state=xyz" });
  });

  it.each([
    "../youtube/start",
    "youtube//start",
    "youtube/start?evil=true",
    "youtube/start%00",
    "youtube/start space",
  ])("ignora segmentos maliciosos: %s", async (segments) => {
    await expect(request(`/api/integrations?__segments=${encodeURIComponent(segments)}`))
      .resolves.toEqual({ status: 404, body: "not-found" });
  });

  it("mantém o comportamento normal quando __segments não existe", async () => {
    const next = vi.fn();
    const req = { url: "/?code=abc", query: { code: "abc" } } as never;
    restoreYouTubeIntegrationPath(req, {} as never, next);
    expect(req.url).toBe("/?code=abc");
    expect(req.query).toEqual({ code: "abc" });
    expect(next).toHaveBeenCalledOnce();
  });
});
