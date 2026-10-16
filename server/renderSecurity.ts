import { createHmac, timingSafeEqual } from "node:crypto";

export const RENDER_CALLBACK_MAX_AGE_SECONDS = 5 * 60;
export const RENDER_PATHS = {
  manifest: "/api/render?op=manifest",
  voice: "/api/render?op=voice",
  input: "/api/render?op=input",
  image: "/api/render?op=image",
  callback: "/api/render?op=callback",
} as const;
const SIGNATURE_PATTERN = /^t=(\d{10}),v1=([a-f0-9]{64})$/;

type SignedRequestContext = { method: string; path: string };

function canonicalPayload(rawBody: string | Buffer, timestampSeconds: number, context: SignedRequestContext) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const prefix = Buffer.from(`${timestampSeconds}.${context.method.toUpperCase()}.${context.path}.`, "utf8");
  return Buffer.concat([prefix, body]);
}

/** Cria HMAC-SHA256 sobre timestamp, método, caminho fixo e bytes exatos do corpo. */
export function signRenderRequest(
  rawBody: string | Buffer,
  secret: string,
  context: SignedRequestContext,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!secret) throw new Error("Segredo HMAC de render não configurado.");
  if (!context.path.startsWith("/api/render?") || context.path.includes("\n") || context.path.includes("\r")) {
    throw new Error("Caminho de render inválido para assinatura.");
  }
  const digest = createHmac("sha256", secret).update(canonicalPayload(rawBody, timestampSeconds, context)).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

/** Valida formato, janela temporal e assinatura sem revelar qual comparação falhou. */
export function verifyRenderRequestSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string | undefined,
  context: SignedRequestContext,
  nowMs = Date.now(),
): boolean {
  if (!secret || !signatureHeader) return false;
  const match = SIGNATURE_PATTERN.exec(signatureHeader.trim());
  if (!match) return false;

  const timestampSeconds = Number(match[1]);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > RENDER_CALLBACK_MAX_AGE_SECONDS) return false;

  const expected = Buffer.from(
    signRenderRequest(rawBody, secret, context, timestampSeconds).slice("t=0000000000,v1=".length),
    "hex",
  );
  const supplied = Buffer.from(match[2], "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/** Compatibilidade explícita para callback do GitHub Actions. */
export function signRenderCallback(rawBody: string | Buffer, secret: string, timestampSeconds = Math.floor(Date.now() / 1000)) {
  return signRenderRequest(rawBody, secret, { method: "POST", path: RENDER_PATHS.callback }, timestampSeconds);
}

export function verifyRenderCallbackSignature(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string | undefined, nowMs = Date.now()) {
  return verifyRenderRequestSignature(rawBody, signatureHeader, secret, { method: "POST", path: RENDER_PATHS.callback }, nowMs);
}
