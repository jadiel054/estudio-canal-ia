import { describe, expect, it, vi } from "vitest";
import type { LLMMessage } from "../llmProviders";
import { redactNexoText, runNexo, type NexoRuntimeDependencies } from "./runtime";
import { NEXO_SYSTEM_PROMPT_VERSION } from "./systemPrompt";

function dependencies(
  complete: NexoRuntimeDependencies["complete"],
  execute: NexoRuntimeDependencies["execute"] = (async () => ({ summary: "ok", actions: [] })) as NexoRuntimeDependencies["execute"],
  maxToolRounds = 4,
): Partial<NexoRuntimeDependencies> {
  return { complete, execute, maxToolRounds };
}

describe("Nexo LOP runtime", () => {
  it("has a versioned identity and sends bounded prior conversation to the model", async () => {
    let received: LLMMessage[] = [];
    const complete = (async (_task, messages) => {
      received = messages;
      return { text: "Claro — a etapa continua manual.", provider: "gemini", inputTokens: 1, outputTokens: 1 };
    }) as NexoRuntimeDependencies["complete"];

    const result = await runNexo("E depois?", [
      { role: "user", content: "Quero testar um render curto." },
      { role: "assistant", content: "O render real exige roteiro aprovado." },
    ], dependencies(complete));

    expect(NEXO_SYSTEM_PROMPT_VERSION).toBe("2.0.1");
    expect(received.slice(-3)).toEqual([
      { role: "user", content: "Quero testar um render curto." },
      { role: "assistant", content: "O render real exige roteiro aprovado." },
      { role: "user", content: "E depois?" },
    ]);
    expect(result.message).toContain("a etapa continua manual");
    expect(result.promptVersion).toBe("2.0.1");
  });

  it("runs tools, feeds verified observations into the next LOP cycle, then reports the model's conclusion", async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ toolCalls: [{ name: "consultar_fila", arguments: {} }], provider: "gemini", inputTokens: 5, outputTokens: 1 })
      .mockImplementationOnce(async (_task, messages: LLMMessage[]) => {
        expect(messages.at(-1)?.content).toContain("2 pautas em pesquisa");
        return { text: "Há 2 pautas em pesquisa; recomendo escolher uma antes de abrir um roteiro.", provider: "gemini", inputTokens: 10, outputTokens: 16 };
      });
    const execute = vi.fn(async () => ({ summary: "2 pautas em pesquisa", actions: [] }));

    const result = await runNexo("O que está na fila?", [], dependencies(complete as unknown as NexoRuntimeDependencies["complete"], execute as unknown as NexoRuntimeDependencies["execute"]));

    expect(complete).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("2 pautas em pesquisa");
    expect(result.toolRounds).toBe(1);
  });

  it("redacts credential-like text from the user message, history, and response", async () => {
    let received: LLMMessage[] = [];
    const credential = `sk-${"x".repeat(30)}`;
    const complete = (async (_task, messages) => {
      received = messages;
      return { text: `Não vou repetir ${credential}.`, provider: "groq", inputTokens: 1, outputTokens: 1 };
    }) as NexoRuntimeDependencies["complete"];

    const result = await runNexo(`Minha senha=${"p".repeat(30)}`, [{ role: "user", content: `Chave ${credential}` }], dependencies(complete));

    expect(JSON.stringify(received)).not.toContain(credential);
    expect(JSON.stringify(received)).toContain("[omitido]");
    expect(result.message).not.toContain(credential);
    expect(result.message).toContain("[segredo omitido]");
  });

  it("does not repeat the same side-effect tool call when the model loops", async () => {
    const call = { name: "criar_pauta", arguments: { titulo: "Agentes tipados em Python", formato: "Short" } };
    const complete = vi.fn(async () => ({ toolCalls: [call], provider: "gemini", inputTokens: 1, outputTokens: 1 }));
    const execute = vi.fn(async () => ({ summary: "Pauta criada e persistida", actions: [] }));

    const result = await runNexo("Crie uma pauta de Short", [], dependencies(complete as unknown as NexoRuntimeDependencies["complete"], execute as unknown as NexoRuntimeDependencies["execute"], 2));

    expect(complete).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("Não vou repetir ações");
    expect(result.message).toContain("A mesma alteração já foi tentada neste turno");
  });

  it("turns tool failures into observations instead of claiming completion", async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ toolCalls: [{ name: "consultar_fila", arguments: {} }], provider: "groq", inputTokens: 1, outputTokens: 1 })
      .mockImplementationOnce(async (_task, messages: LLMMessage[]) => {
        expect(messages.at(-1)?.content).toContain("falhou no Neon");
        return { text: "Não consegui consultar porque o Neon falhou.", provider: "groq", inputTokens: 3, outputTokens: 5 };
      });
    const execute = vi.fn(async () => { throw new Error("falhou no Neon"); });

    const result = await runNexo("Consulte a fila", [], dependencies(complete as unknown as NexoRuntimeDependencies["complete"], execute as unknown as NexoRuntimeDependencies["execute"]));

    expect(result.message).toContain("Neon falhou");
    expect(result.actions).toEqual([]);
  });

  it("redacts common key patterns before they can be returned", () => {
    expect(redactNexoText(`token=ghp_${"a".repeat(30)}`)).toContain("token=[segredo omitido]");
    expect(redactNexoText("senha=temporaria" )).toContain("[omitido]");
  });
});
