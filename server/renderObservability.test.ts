import { describe, expect, it } from "vitest";
import { classifyRenderFailure, isRenderErrorCode, isRenderOperation, renderFailureSummary } from "./renderObservability";
import { TtsProviderError } from "./ttsProvider";

describe("observabilidade segura do render", () => {
  it("classifica timeout do TTS com código fixo e status numérico do provedor", () => {
    const error = new TtsProviderError("mensagem não deve aparecer: roteiro privado", 429, "timeout");
    const diagnostic = { operation: "voice" as const, ...classifyRenderFailure("voice", error), httpStatus: 400 };
    expect(diagnostic).toEqual({ operation: "voice", errorCode: "tts_timeout", upstreamStatus: 429, httpStatus: 400 });
    expect(renderFailureSummary(diagnostic)).toBe("operation=voice code=tts_timeout http=400 upstream=429");
    expect(renderFailureSummary(diagnostic)).not.toContain("roteiro privado");
  });

  it("usa código genérico fixo para falhas não classificadas", () => {
    expect(classifyRenderFailure("manifest", new Error("segredo ou texto editorial"))).toEqual({ errorCode: "manifest_operation_failed" });
  });

  it("aceita apenas operações e códigos previamente definidos", () => {
    expect(isRenderOperation("voice")).toBe(true);
    expect(isRenderOperation("token-secreto")).toBe(false);
    expect(isRenderErrorCode("tts_unavailable")).toBe(true);
    expect(isRenderErrorCode("texto livre com segredo")).toBe(false);
    expect(renderFailureSummary({ operation: "voice" as any, errorCode: "texto livre" as any, httpStatus: 400 })).toBe("operation=voice code=render_failed http=400");
  });
});
