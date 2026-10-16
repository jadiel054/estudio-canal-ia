import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRenderDeliveryRoutes } from "./renderDelivery";

const jobId = "550e8400-e29b-41d4-a716-446655440000";
const token = "test-only-github-token-never-returned";
const signedUrl = "https://objects.githubusercontent.com/github-production-release-asset/test.mp4?signature=private-signed-url";
const originalBytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const asset = { releaseId: 123, assetId: 456, fileName: "prova.mp4" };

const readSession = vi.fn();
const getAsset = vi.fn();
const getToken = vi.fn();
const fetchImpl = vi.fn();
const log = vi.fn();
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  registerRenderDeliveryRoutes(app, { readSession, getAsset, getToken, fetchImpl, log });
  server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  readSession.mockReset().mockResolvedValue({ id: "owner:test" });
  getAsset.mockReset().mockResolvedValue(asset);
  getToken.mockReset().mockReturnValue(token);
  fetchImpl.mockReset();
  log.mockReset();
});

function githubRedirect(location = signedUrl) {
  return new Response(null, { status: 302, headers: { location } });
}

function request(path: string, range?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      cookie: "studio_session=test-session",
      ...(range ? { range } : {}),
    },
  });
}

function responseBody(bytes: Uint8Array, status = 200, headers: Record<string, string> = {}) {
  return new Response(bytes, { status, headers: { "content-length": String(bytes.byteLength), ...headers } });
}

describe("entrega autenticada de render", () => {
  it("serve o download com attachment e bytes íntegros após o redirect assinado do GitHub", async () => {
    fetchImpl.mockResolvedValueOnce(githubRedirect()).mockResolvedValueOnce(responseBody(originalBytes));

    const response = await request(`/api/render/download/${jobId}?download=1`);
    const receivedBytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("video/mp4");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(receivedBytes).toEqual(originalBytes);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [apiUrl, apiOptions] = fetchImpl.mock.calls[0];
    expect(String(apiUrl)).toBe("https://api.github.com/repos/jadiel054/estudio-canal-ia/releases/assets/456");
    expect(new Headers(apiOptions.headers).get("authorization")).toBe(`Bearer ${token}`);
    const [assetUrl, assetOptions] = fetchImpl.mock.calls[1];
    expect(String(assetUrl)).toBe(signedUrl);
    expect(new Headers(assetOptions.headers).get("authorization")).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("serve preview inline com video/mp4 e Accept-Ranges", async () => {
    fetchImpl.mockResolvedValueOnce(githubRedirect()).mockResolvedValueOnce(responseBody(originalBytes));

    const response = await request(`/api/render/preview/${jobId}`);
    const receivedBytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("video/mp4");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(receivedBytes).toEqual(originalBytes);
  });

  it("atende a query do destino estático usada pelos rewrites Vercel", async () => {
    fetchImpl.mockResolvedValueOnce(githubRedirect()).mockResolvedValueOnce(responseBody(originalBytes));

    const response = await request(`/api/render?delivery=download&jobId=${jobId}`);
    const receivedBytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(receivedBytes).toEqual(originalBytes);
  });

  it("encaminha Range ao GitHub e responde 206 com o trecho e Content-Range corretos", async () => {
    const range = "bytes=3-6";
    const chunk = originalBytes.slice(3, 7);
    fetchImpl.mockResolvedValueOnce(githubRedirect()).mockResolvedValueOnce(responseBody(chunk, 206, {
      "content-range": "bytes 3-6/10",
    }));

    const response = await request(`/api/render/preview/${jobId}`, range);
    const receivedBytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 3-6/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(receivedBytes).toEqual(chunk);
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).get("range")).toBe(range);
    expect(new Headers(fetchImpl.mock.calls[1][1].headers).get("range")).toBe(range);
  });

  it("rejeita sessão inválida com stageCode allowlisted sem consultar asset ou GitHub", async () => {
    readSession.mockResolvedValueOnce(null);

    const response = await request(`/api/render/download/${jobId}`);
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("x-render-stage-code")).toBe("sessao_invalida");
    expect(getAsset).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(body).not.toContain(token);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ stageCode: "sessao_invalida", httpStatus: 401 }));
  });

  it("retorna asset ausente com código específico", async () => {
    getAsset.mockResolvedValueOnce(null);

    const response = await request(`/api/render/preview/${jobId}`);

    expect(response.status).toBe(404);
    expect(response.headers.get("x-render-stage-code")).toBe("asset_ausente");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("não registra nem devolve token, URL assinada ou corpo upstream em falhas", async () => {
    const privateBody = "private upstream body with secret";
    fetchImpl.mockResolvedValueOnce(new Response(privateBody, { status: 503 }));

    const response = await request(`/api/render/download/${jobId}`);
    const body = await response.text();
    const record = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(502);
    expect(response.headers.get("x-render-stage-code")).toBe("upstream_indisponivel");
    for (const secret of [token, signedUrl, privateBody]) {
      expect(body).not.toContain(secret);
      expect(record).not.toContain(secret);
    }
  });

  it("converte exceções de rede em stageCode seguro sem expor a mensagem", async () => {
    const privateMessage = `network failure ${token} ${signedUrl}`;
    fetchImpl.mockRejectedValueOnce(new Error(privateMessage));

    const response = await request(`/api/render/preview/${jobId}`);
    const body = await response.text();
    const record = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(502);
    expect(response.headers.get("x-render-stage-code")).toBe("upstream_indisponivel");
    expect(body).not.toContain(privateMessage);
    expect(record).not.toContain(privateMessage);
    expect(record).not.toContain(token);
    expect(record).not.toContain(signedUrl);
  });

  it("recusa redirect sem Location", async () => {
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 302 }));

    const response = await request(`/api/render/preview/${jobId}`);

    expect(response.status).toBe(502);
    expect(response.headers.get("x-render-stage-code")).toBe("redirect_invalido");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recusa redirects para hosts fora do allowlist sem expor a URL", async () => {
    const privateLocation = "https://attacker.example/file?signature=private";
    fetchImpl.mockResolvedValueOnce(githubRedirect(privateLocation));

    const response = await request(`/api/render/preview/${jobId}`);
    const body = await response.text();
    const record = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(502);
    expect(response.headers.get("x-render-stage-code")).toBe("redirect_invalido");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body).not.toContain(privateLocation);
    expect(record).not.toContain(privateLocation);
  });
});

describe("roteamento Vercel das rotas públicas de entrega", () => {
  it("mapeia URLs aninhadas para a Function estática /api/render antes do fallback SPA", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const download = config.rewrites.find(item => item.source === "/api/render/download/:jobId");
    const preview = config.rewrites.find(item => item.source === "/api/render/preview/:jobId");
    const spa = config.rewrites.find(item => item.destination === "/index.html");

    expect(download?.destination).toBe("/api/render?delivery=download&jobId=:jobId");
    expect(preview?.destination).toBe("/api/render?delivery=preview&jobId=:jobId");
    expect(config.rewrites.indexOf(download!)).toBeLessThan(config.rewrites.indexOf(spa!));
    expect(config.rewrites.indexOf(preview!)).toBeLessThan(config.rewrites.indexOf(spa!));
  });
});
