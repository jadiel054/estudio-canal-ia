import { describe, expect, it } from "vitest";
import {
  RENDER_CALLBACK_MAX_AGE_SECONDS,
  RENDER_PATHS,
  signRenderCallback,
  signRenderRequest,
  verifyRenderCallbackSignature,
  verifyRenderRequestSignature,
} from "./renderSecurity";

describe("render request HMAC", () => {
  const secret = "unit-test-secret-never-used-in-production";
  const body = Buffer.from('{"jobId":"job-test","status":"succeeded"}', "utf8");
  const nowMs = 1_800_000_000_000;
  const timestamp = Math.floor(nowMs / 1000);
  const callback = { method: "POST", path: RENDER_PATHS.callback };

  it("accepts the exact signed bytes and route inside the allowed time window", () => {
    const signature = signRenderRequest(body, secret, callback, timestamp);
    expect(verifyRenderRequestSignature(body, signature, secret, callback, nowMs)).toBe(true);
  });

  it("rejects changed payload bytes, method, route, and secret", () => {
    const signature = signRenderRequest(body, secret, callback, timestamp);
    expect(verifyRenderRequestSignature(Buffer.from(`${body} `), signature, secret, callback, nowMs)).toBe(false);
    expect(verifyRenderRequestSignature(body, signature, secret, { ...callback, method: "GET" }, nowMs)).toBe(false);
    expect(verifyRenderRequestSignature(body, signature, secret, { ...callback, path: RENDER_PATHS.manifest }, nowMs)).toBe(false);
    expect(verifyRenderRequestSignature(body, signature, "another-secret", callback, nowMs)).toBe(false);
  });

  it("rejects signatures outside the anti-replay window", () => {
    const signature = signRenderRequest(body, secret, callback, timestamp);
    const expiredNow = nowMs + (RENDER_CALLBACK_MAX_AGE_SECONDS + 1) * 1000;
    expect(verifyRenderRequestSignature(body, signature, secret, callback, expiredNow)).toBe(false);
  });

  it("rejects missing secrets, missing headers, and malformed signatures", () => {
    expect(verifyRenderRequestSignature(body, undefined, secret, callback, nowMs)).toBe(false);
    expect(verifyRenderRequestSignature(body, "not-a-signature", secret, callback, nowMs)).toBe(false);
    expect(verifyRenderRequestSignature(body, "t=1800000000,v1=abcd", undefined, callback, nowMs)).toBe(false);
  });

  it("keeps callback compatibility bound to its one fixed endpoint", () => {
    const signature = signRenderCallback(body, secret, timestamp);
    expect(verifyRenderCallbackSignature(body, signature, secret, nowMs)).toBe(true);
    expect(() => signRenderRequest(body, secret, { method: "POST", path: "/api/render?op=callback\n/api/trpc" }, timestamp)).toThrow("Caminho");
  });
});
