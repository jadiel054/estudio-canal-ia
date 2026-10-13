import { createHmac, timingSafeEqual } from "node:crypto";

export const RENDER_CALLBACK_MAX_AGE_SECONDS = 5 * 60;
const SIGNATURE_PATTERN = /^t=(\d{10}),v1=([a-f0-9]{64})$/;

/** Cria assinatura HMAC-SHA256 sobre timestamp e bytes exatos do corpo. */
export function signRenderCallback(
  rawBody: string | Buffer,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!secret) throw new Error("Segredo HMAC de callback não configurado.");
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const digest = createHmac("sha256", secret)
    .update(`${timestampSeconds}.`)
    .update(body)
    .digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

/** Valida formato, janela temporal e assinatura sem revelar qual comparação falhou. */
export function verifyRenderCallbackSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!secret || !signatureHeader) return false;
  const match = SIGNATURE_PATTERN.exec(signatureHeader.trim());
  if (!match) return false;

  const timestampSeconds = Number(match[1]);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > RENDER_CALLBACK_MAX_AGE_SECONDS) {
    return false;
  }

  const expected = Buffer.from(
    signRenderCallback(rawBody, secret, timestampSeconds).slice("t=0000000000,v1=".length),
    "hex",
  );
  const supplied = Buffer.from(match[2], "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
