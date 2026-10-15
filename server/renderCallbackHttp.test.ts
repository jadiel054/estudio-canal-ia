import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerApiRoutes } from "./app";
import { signRenderCallback } from "./renderSecurity";

const testSecret = "hmac-local-de-teste-nao-usado-em-producao-123456";
let server: Server;
let baseUrl = "";
let previousSecret: string | undefined;

beforeAll(async () => {
  previousSecret = process.env.STUDIO_RENDER_HMAC_SECRET;
  process.env.STUDIO_RENDER_HMAC_SECRET = testSecret;
  const app = express();
  registerApiRoutes(app);
  server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (previousSecret === undefined) delete process.env.STUDIO_RENDER_HMAC_SECRET;
  else process.env.STUDIO_RENDER_HMAC_SECRET = previousSecret;
});

async function postCallback(body: string, signature: string) {
  return fetch(`${baseUrl}/api/render?op=callback`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-render-signature": signature },
    body,
  });
}

describe("instrumentação HTTP do callback", () => {
  it("registra etapa de assinatura inválida sem payload ou segredo", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify({ message: "roteiro privado" });
    try {
      const response = await postCallback(body, "assinatura-inválida");
      const result = await response.json();
      expect(response.status).toBe(401);
      expect(result).toMatchObject({ error: "callback_signature_invalid", stageCode: "assinatura" });
      expect(response.headers.get("x-render-stage-code")).toBe("assinatura");
      const record = JSON.parse(String(warning.mock.calls[0][0]));
      expect(record).toMatchObject({ event: "falha_operacao_render", operation: "callback", errorCode: "callback_signature_invalid", httpStatus: 401, stageCode: "assinatura" });
      expect(JSON.stringify(record)).not.toContain("roteiro privado");
      expect(JSON.stringify(record)).not.toContain(testSecret);
    } finally { warning.mockRestore(); }
  });

  it("registra etapa de payload inválido após aceitar assinatura, sem serializar o corpo", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify(["conteúdo editorial privado"]);
    try {
      const response = await postCallback(body, signRenderCallback(body, testSecret));
      const result = await response.json();
      expect(response.status).toBe(400);
      expect(result).toMatchObject({ error: "callback_payload_invalid", stageCode: "validacao_payload" });
      expect(response.headers.get("x-render-stage-code")).toBe("validacao_payload");
      const record = JSON.parse(String(warning.mock.calls[0][0]));
      expect(record).toMatchObject({ event: "falha_operacao_render", operation: "callback", errorCode: "callback_payload_invalid", httpStatus: 400, stageCode: "validacao_payload" });
      expect(JSON.stringify(record)).not.toContain("conteúdo editorial privado");
    } finally { warning.mockRestore(); }
  });
});
