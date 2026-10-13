import { describe, expect, it } from "vitest";
import {
  RENDER_CALLBACK_MAX_AGE_SECONDS,
  signRenderCallback,
  verifyRenderCallbackSignature,
} from "./renderSecurity";

describe("render callback HMAC", () => {
  const secret = "unit-test-secret-never-used-in-production";
  const body = Buffer.from('{"jobId":"job-test","status":"succeeded"}', "utf8");
  const nowMs = 1_800_000_000_000;
  const timestamp = Math.floor(nowMs / 1000);

  it("accepts the exact signed bytes inside the allowed time window", () => {
    const signature = signRenderCallback(body, secret, timestamp);
    expect(verifyRenderCallbackSignature(body, signature, secret, nowMs)).toBe(true);
  });

  it("rejects changed payload bytes and a different secret", () => {
    const signature = signRenderCallback(body, secret, timestamp);
    expect(verifyRenderCallbackSignature(Buffer.from(`${body} `), signature, secret, nowMs)).toBe(false);
    expect(verifyRenderCallbackSignature(body, signature, "another-secret", nowMs)).toBe(false);
  });

  it("rejects signatures outside the anti-replay window", () => {
    const signature = signRenderCallback(body, secret, timestamp);
    const expiredNow = nowMs + (RENDER_CALLBACK_MAX_AGE_SECONDS + 1) * 1000;
    expect(verifyRenderCallbackSignature(body, signature, secret, expiredNow)).toBe(false);
  });

  it("rejects missing secrets, missing headers, and malformed signatures", () => {
    expect(verifyRenderCallbackSignature(body, undefined, secret, nowMs)).toBe(false);
    expect(verifyRenderCallbackSignature(body, "not-a-signature", secret, nowMs)).toBe(false);
    expect(verifyRenderCallbackSignature(body, "t=1800000000,v1=abcd", undefined, nowMs)).toBe(false);
  });
});
