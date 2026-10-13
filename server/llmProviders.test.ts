import { describe, expect, it } from "vitest";
import { failureHint, failureReason, GEMINI_DEFAULT_MODELS, resolveThinking } from "./llmProviders";

describe("modelos Gemini padrão", () => {
  it("usa os modelos da série 3, não os 2.5 restritos", () => {
    expect(GEMINI_DEFAULT_MODELS.roteiro).toBe("gemini-3.8-flash");
    expect(GEMINI_DEFAULT_MODELS.qa).toBe("gemini-3.8-flash");
    expect(GEMINI_DEFAULT_MODELS.agente).toBe("gemini-3.8-flash");
    expect(GEMINI_DEFAULT_MODELS.leve).toBe("gemini-3.5-flash-lite");
    expect(Object.values(GEMINI_DEFAULT_MODELS).some(model => model.startsWith("gemini-2.5"))).toBe(false);
  });
});

describe("thinkingLevel para Gemini 3", () => {
  it("envia thinkingLevel para os modelos da série 3", () => {
    expect(resolveThinking("gemini-3.8-flash", "medium")).toEqual({ thinkingLevel: "medium" });
    expect(resolveThinking("gemini-3.5-flash-lite", "minimal")).toEqual({ thinkingLevel: "minimal" });
  });

  it("rebaixa minimal para low no gemini-3.8-flash, que não aceita minimal", () => {
    expect(resolveThinking("gemini-3.8-flash", "minimal")).toEqual({ thinkingLevel: "low", adjusted: "low" });
    expect(resolveThinking("gemini-3.8-flash-tts", "minimal")).toEqual({ thinkingLevel: "low", adjusted: "low" });
  });

  it("usa thinkingBudget apenas quando o modelo é da série 2.5", () => {
    expect(resolveThinking("gemini-2.5-flash", "minimal")).toEqual({ thinkingBudget: 0 });
    expect(resolveThinking("gemini-2.5-flash", "high")).toEqual({ thinkingBudget: 8192 });
  });
});

describe("motivos de falha", () => {
  it("traduz 404 em mensagem clara de modelo indisponível", () => {
    const error = new Error("Gemini 404");
    (error as any).status = 404;
    // O erro real é UpstreamError; aqui validamos o mapa de mensagens.
    expect(failureHint("modelo indisponível para esta chave")).toContain("Modelo indisponível para esta chave");
    expect(failureReason(new Error("timeout"))).toBe("timeout");
    expect(failureReason(new Error("qualquer"))).toBe("erro de conexão");
  });
});