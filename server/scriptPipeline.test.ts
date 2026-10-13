import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  let state: any;
  return {
    get state() { return state; },
    set state(value: any) { state = value; },
    getStudioState: vi.fn(async () => state ? JSON.parse(JSON.stringify(state)) : null),
    executeEditorialCommand: vi.fn(async (command: any, context: any) => ({ state, command, context })),
    completeWithFallback: vi.fn(),
  };
});

vi.mock("./studioRepository", () => ({ getStudioState: mocked.getStudioState }));
vi.mock("./editorial", () => ({ executeEditorialCommand: mocked.executeEditorialCommand }));
vi.mock("./llmProviders", () => ({ completeWithFallback: mocked.completeWithFallback }));

import { reviewScriptForCurrentDraft } from "./scriptPipeline";

function baseState() {
  return {
    ideas: [{ id: "idea-1", title: "Pauta técnica", format: "Longo", status: "aguarda_aprov_roteiro" }],
    scripts: [{ id: "script-1", ideaId: "idea-1", title: "Pauta técnica", status: "Aguardando aprovação", version: 1, updatedAt: "2026-10-13T10:00:00.000Z", content: "rascunho antigo" }],
  };
}

const validQa = {
  estimatedDurationMinutes: 5,
  technicalFlags: [{ excerpt: "token", reason: "Confirmar que nenhum segredo é exibido." }],
  repetitionFlags: [],
  policyTerms: [],
  demoSpecified: false,
  demoEvidence: "não especificada",
  genericContentRisk: "médio",
  summary: "Revisão automática; confira as fontes e a execução antes da aprovação.",
};

describe("revisão QA do roteiro atual", () => {
  beforeEach(() => {
    mocked.state = baseState();
    mocked.getStudioState.mockClear();
    mocked.executeEditorialCommand.mockClear();
    mocked.completeWithFallback.mockReset().mockResolvedValue({ text: JSON.stringify(validQa), provider: "gemini" });
  });

  it("analisa o texto fornecido e salva-o com o QA sem gerar outro roteiro", async () => {
    const content = "Texto corrigido pelo dono que deve ser analisado sem substituição.";
    const result = await reviewScriptForCurrentDraft("script-1", content);

    expect(mocked.completeWithFallback).toHaveBeenCalledTimes(1);
    expect(mocked.completeWithFallback.mock.calls[0][0]).toBe("qa");
    expect(mocked.completeWithFallback.mock.calls[0][1][1].content).toContain(content);
    expect(mocked.executeEditorialCommand).toHaveBeenCalledWith(
      { operation: "updateScript", scriptId: "script-1", content },
      expect.objectContaining({ actor: "Você", qa: expect.objectContaining({ classifier: "llm" }), expectedScript: expect.objectContaining({ content: "rascunho antigo", version: 1 }) }),
    );
    expect(result.qaProvider).toBe("gemini");
  });

  it("bloqueia itens de exemplo antes de chamar o provedor", async () => {
    mocked.state.scripts[0].example = true;
    await expect(reviewScriptForCurrentDraft("script-1", "texto" )).rejects.toThrow("itens de demonstração");
    expect(mocked.completeWithFallback).not.toHaveBeenCalled();
    expect(mocked.executeEditorialCommand).not.toHaveBeenCalled();
  });

  it("usa QA local limitado se o provedor falhar e não descarta o texto atual", async () => {
    mocked.completeWithFallback.mockRejectedValue(new Error("indisponível"));
    const content = "Texto longo com uma demonstração a validar; esta captura não foi executada.";
    const result = await reviewScriptForCurrentDraft("script-1", content);
    expect(result.qaProvider).toBe("heuristic");
    expect(result.qa.classifier).toBe("heuristic");
    expect(mocked.executeEditorialCommand).toHaveBeenCalledWith(
      { operation: "updateScript", scriptId: "script-1", content },
      expect.objectContaining({ qa: expect.objectContaining({ classifier: "heuristic" }) }),
    );
  });
});
