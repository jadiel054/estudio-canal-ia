import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { describe, expect, it, afterEach } from "vitest";
import { createStudioApp } from "./handler";

const trpcInput = "?input=%7B%22json%22%3Anull%7D";
let server: Server | undefined;

async function start() {
  server = createServer(createStudioApp());
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Servidor de teste não iniciou");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

describe("cache policy", () => {
  it("never lets the service worker intercept API or cache HTML", async () => {
    const worker = await readFile(new URL("../client/public/service-worker.js", import.meta.url), "utf8");
    expect(worker).toContain('if (isApi(requestUrl)) return;');
    expect(worker).toContain('event.request.mode === "navigate"');
    expect(worker).toContain('fetch(event.request).catch(() => caches.match(OFFLINE_PAGE))');
    expect(worker).toContain('const CACHE = "estudio-canal-ia-v2"');
    expect(worker).toContain('self.skipWaiting()');
    expect(worker).toContain('self.clients.claim()');
    expect(worker).toContain('caches.delete(key)');
    expect(worker).not.toContain('cache.put(event.request, copy)');
  });

  it("returns fresh auth.config and auth.me responses with no-store", async () => {
    process.env.STUDIO_OWNER_EMAIL = "first@example.com";
    process.env.STUDIO_SESSION_SECRET = "test-session-secret-with-at-least-32-chars";
    const base = await start();

    const firstConfig = await fetch(`${base}/api/trpc/auth.config${trpcInput}`);
    expect(firstConfig.headers.get("cache-control")).toContain("no-store");
    const firstBody = await firstConfig.text();
    expect(firstBody).toContain('"configured":true');
    // A rota é pública: o e-mail do dono nunca pode aparecer na resposta.
    expect(firstBody).not.toContain("first@example.com");

    // Prova de que a resposta é recalculada a cada requisição (não vem de cache):
    // sem o segredo de sessão, a configuração deixa de estar pronta.
    delete process.env.STUDIO_SESSION_SECRET;
    const secondConfig = await fetch(`${base}/api/trpc/auth.config${trpcInput}`);
    expect(await secondConfig.text()).toContain('"configured":false');
    process.env.STUDIO_SESSION_SECRET = "test-session-secret-with-at-least-32-chars";

    const me = await fetch(`${base}/api/trpc/auth.me${trpcInput}`);
    expect(me.headers.get("cache-control")).toContain("no-store");
    expect(await me.text()).toContain('"data":{"json":null}');
  });
});
