import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateImagePayload } from "./imageValidation";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(23);
  bytes.writeUInt16BE(0xffd8, 0);
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes.writeUInt16BE(17, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes[11] = 3;
  bytes.writeUInt16BE(1, 12);
  bytes[14] = 0x11;
  bytes[15] = 0;
  bytes.writeUInt16BE(2, 16);
  bytes[18] = 0x11;
  bytes[19] = 0;
  bytes.writeUInt16BE(3, 20);
  bytes[22] = 0xff;
  // A compact SOF header is enough for the deterministic metadata gate.
  return bytes;
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

function check(
  bytes: Buffer,
  mimeType: string,
  width: number,
  height: number,
  maxBytes = 1024
) {
  return validateImagePayload({
    bytes,
    declaredMimeType: mimeType,
    expectedWidth: width,
    expectedHeight: height,
    maxBytes,
  });
}

describe("validação de imagem gerada", () => {
  it("aceita assinatura PNG e calcula SHA-256 do conteúdo antes de persistir", () => {
    const bytes = png(640, 360);
    const result = check(bytes, "image/png", 640, 360);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.image.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex")
      );
      expect(result.image.mimeType).toBe("image/png");
      expect(result.image.width).toBe(640);
      expect(result.image.height).toBe(360);
    }
  });

  it.each([
    ["JPEG", jpeg(320, 180), "image/jpeg"],
    ["WebP VP8X", webp(320, 180), "image/webp"],
  ])("reconhece dimensões pelo cabeçalho %s", (_name, bytes, mimeType) => {
    expect(check(bytes as Buffer, mimeType as string, 320, 180).ok).toBe(true);
  });

  it("rejeita MIME declarado divergente, dimensões divergentes e arquivos grandes", () => {
    expect(check(png(64, 64), "image/jpeg", 64, 64)).toEqual({
      ok: false,
      code: "mime_mismatch",
    });
    expect(check(png(64, 64), "image/png", 32, 64)).toEqual({
      ok: false,
      code: "dimension_mismatch",
    });
    expect(check(png(64, 64), "image/png", 64, 64, 16)).toEqual({
      ok: false,
      code: "size_exceeded",
    });
  });

  it("rejeita bytes inválidos, MIME não permitido e dimensões fora do limite", () => {
    expect(check(Buffer.from("prompt privado"), "image/png", 64, 64)).toEqual({
      ok: false,
      code: "invalid_image_bytes",
    });
    expect(check(png(64, 64), "image/svg+xml", 64, 64)).toEqual({
      ok: false,
      code: "unsupported_mime",
    });
    expect(check(png(64, 64), "image/png", 0, 64)).toEqual({
      ok: false,
      code: "invalid_dimensions",
    });
  });
});
