import { describe, expect, it, vi } from "vitest";
import { CloudflareImageProvider, createConfiguredCloudflareImageProvider } from "./cloudflareImageProvider";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("CloudflareImageProvider", () => {
  it("envia autenticação, prompt e dimensões e decodifica image base64", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret-token" });
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: "uma tela", width: 1280, height: 720 });
      return new Response(JSON.stringify({ result: { image: pngBase64 } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new CloudflareImageProvider({ accountId: "account", apiToken: "secret-token", fetcher });
    const output = await provider.generate({ visualDirection: "uma tela", preset: "tutorial-visual-v1", width: 1280, height: 720, model: "@cf/model", modelRevision: "rev" });
    expect(output.mimeType).toBe("image/png");
    expect(output.bytes.length).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("converte uma resposta HTTP de imagem diretamente", async () => {
    const fetcher = vi.fn(async () => new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } }));
    const provider = new CloudflareImageProvider({ accountId: "account", apiToken: "token", fetcher });
    await expect(provider.generate({ visualDirection: "x", preset: "tutorial-visual-v1", width: 1, height: 1, model: "model", modelRevision: "rev" })).resolves.toMatchObject({ mimeType: "image/webp", bytes: Uint8Array.from([1, 2, 3]) });
  });

  it("não cria adapter sem account id ou token", () => {
    expect(createConfiguredCloudflareImageProvider({ env: {} })).toBeUndefined();
    expect(createConfiguredCloudflareImageProvider({ env: { CLOUDFLARE_ACCOUNT_ID: "account" } })).toBeUndefined();
    expect(createConfiguredCloudflareImageProvider({ env: { CLOUDFLARE_API_TOKEN: "token" } })).toBeUndefined();
  });
});
