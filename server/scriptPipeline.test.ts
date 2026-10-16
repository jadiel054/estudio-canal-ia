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

import { generateScriptForIdea, reviewScriptForCurrentDraft } from "./scriptPipeline";

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

  it("instrui geração de roteiro a separar direção Visual de fala em blocos rotulados", async () => {
    mocked.state.ideas[0].status = "roteiro";
    const generatedContent = [
      "# Gancho",
      "**Visual:** Aproximar a tela do mapa de embeddings.",
      "**Nota de produção:** NOTA_INTERNA_TESTE_NAO_ENVIAR_AO_QA.",
      "**Áudio (Narração):** Hoje vamos comparar representações vetoriais de texto.",
      "# Demonstração",
      "Visual: Mostrar a consulta e os resultados na interface.",
      "Áudio (Narração): Observe como uma busca semântica encontra trechos relacionados.",
    ].join("\n");
    mocked.completeWithFallback
      .mockResolvedValueOnce({ text: generatedContent, provider: "groq" })
      .mockResolvedValueOnce({ text: JSON.stringify(validQa), provider: "gemini" });

    await generateScriptForIdea("idea-1");

    expect(mocked.completeWithFallback.mock.calls[0][0]).toBe("roteiro");
    const generationPrompt = mocked.completeWithFallback.mock.calls[0][1][1].content as string;
    expect(generationPrompt).toContain("**Visual:**");
    expect(generationPrompt).toContain("**Áudio (Narração):**");
    expect(generationPrompt).toContain("**Nota de produção:**");
    expect(generationPrompt).toContain("nunca pode ser fala, legenda ou texto de slide");
    const qaPrompt = mocked.completeWithFallback.mock.calls[1][1][0].content as string;
    expect(qaPrompt).toContain("não é fala e não deve entrar na duração estimada");
    expect(qaPrompt).toContain("o servidor a calcula localmente");
    const qaUserContent = mocked.completeWithFallback.mock.calls[1][1][1].content as string;
    expect(qaUserContent).toContain("Hoje vamos comparar representações vetoriais de texto.");
    expect(qaUserContent).not.toContain("Aproximar a tela");
    expect(qaUserContent).not.toContain("NOTA_INTERNA_TESTE");
    expect(qaUserContent).not.toContain("Mostrar a consulta");
    expect(mocked.executeEditorialCommand).toHaveBeenCalledWith(
      { operation: "generateScript", ideaId: "idea-1", content: generatedContent },
      expect.objectContaining({ qa: expect.objectContaining({ classifier: "llm", lintDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "script_production_note_non_actionable", severity: "warning" })]) }) }),
    );
  });

  it("bloqueia itens de exemplo antes de chamar o provedor", async () => {
    mocked.state.scripts[0].example = true;
    await expect(reviewScriptForCurrentDraft("script-1", "texto" )).rejects.toThrow("itens de demonstração");
    expect(mocked.completeWithFallback).not.toHaveBeenCalled();
    expect(mocked.executeEditorialCommand).not.toHaveBeenCalled();
  });

  it("usa QA local limitado se o provedor falhar e não descarta o texto atual", async () => {
    mocked.completeWithFallback.mockRejectedValue(new Error("indisponível"));
    const longVisualNote = Array.from({ length: 100 }, () => "captura").join(" ");
    const content = `# Demonstração\n**Visual:** ${longVisualNote}\n**Áudio (Narração):** Fala curta.`;
    const result = await reviewScriptForCurrentDraft("script-1", content);
    expect(result.qaProvider).toBe("heuristic");
    expect(result.qa.classifier).toBe("heuristic");
    expect(result.qa.estimatedDurationMinutes).toBe(0.5);
    expect(result.qa.lintDiagnostics).not.toContainEqual(expect.objectContaining({ severity: "error" }));
    const qaUserContent = mocked.completeWithFallback.mock.calls[0][1][1].content as string;
    expect(qaUserContent).toContain("Fala curta.");
    expect(qaUserContent).not.toContain(longVisualNote);
    expect(mocked.executeEditorialCommand).toHaveBeenCalledWith(
      { operation: "updateScript", scriptId: "script-1", content },
      expect.objectContaining({ qa: expect.objectContaining({ classifier: "heuristic" }) }),
    );
  });

  it("mantém diagnostics bloqueantes e calcula a duração só a partir de cues falados válidos", async () => {
    const privateNote = "METADATA_PRIVADA_NAO_DEVE_SER_ENVIADA";
    const content = [
      "# Demonstração",
      "**Visual:** Exibir o painel sem dados pessoais.",
      `**Nota de produção:** ${privateNote}`,
      "**Áudio (Narração):** Fala curta.",
      "",
      "Texto solto não pode virar fala nem influenciar duração.",
    ].join("\n");
    const result = await reviewScriptForCurrentDraft("script-1", content);
    expect(result.qa.estimatedDurationMinutes).toBe(0.5);
    expect(result.qa.lintDiagnostics).toContainEqual(expect.objectContaining({ code: "script_unlabeled_paragraph", severity: "error" }));
    const qaUserContent = mocked.completeWithFallback.mock.calls[0][1][1].content as string;
    expect(qaUserContent).toContain("Fala curta.");
    expect(qaUserContent).not.toContain("Exibir o painel");
    expect(qaUserContent).not.toContain(privateNote);
    expect(qaUserContent).not.toContain("Texto solto não pode");
    expect(mocked.executeEditorialCommand).toHaveBeenCalledWith(
      { operation: "updateScript", scriptId: "script-1", content },
      expect.objectContaining({ qa: expect.objectContaining({ estimatedDurationMinutes: 0.5, lintDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "script_unlabeled_paragraph", severity: "error" })]) }) }),
    );
  });

  it("emite warning de captura por seção usando apenas assets prontos da versão atual", async () => {
    mocked.state.assets = [
      { scriptId: "script-1", scriptVersion: 1, type: "Tela", status: "Pronto", inputAssetId: "input-current", sectionIndex: 0, fileName: "private.png" },
      { scriptId: "script-1", scriptVersion: 2, type: "Tela", status: "Pronto", inputAssetId: "input-future", sectionIndex: 1 },
      { scriptId: "other-script", scriptVersion: 1, type: "Tela", status: "Pronto", inputAssetId: "input-other", sectionIndex: 1 },
    ];
    const content = [
      "# Abertura",
      "**Visual:** Mostrar a tela de captura existente.",
      "**Áudio (Narração):** Fala da primeira seção.",
      "# Resultado",
      "**Visual:** Mostrar o resultado final.",
      "**Áudio (Narração):** Fala da segunda seção.",
    ].join("\n");
    const result = await reviewScriptForCurrentDraft("script-1", content);
    const missingCapture = result.qa.lintDiagnostics.filter(item => item.code === "script_visual_without_capture");
    expect(missingCapture).toHaveLength(1);
    expect(missingCapture[0]).toMatchObject({ severity: "warning", sectionIndex: 1, section: "Resultado" });
    const qaUserContent = mocked.completeWithFallback.mock.calls[0][1][1].content as string;
    expect(qaUserContent).not.toContain("private.png");
    expect(qaUserContent).not.toContain("input-current");
  });

  it("limita a duração derivada de fala ao máximo persistível quando o lint bloqueia cues em excesso", async () => {
    const speech = "a ".repeat(44_999).trim();
    const content = `**Áudio (Narração):** ${speech}`;
    const result = await reviewScriptForCurrentDraft("script-1", content);
    expect(result.qa.estimatedDurationMinutes).toBe(240);
    expect(result.qa.lintDiagnostics).toContainEqual(expect.objectContaining({ code: "script_too_many_audio_cues", severity: "error" }));
  });

  it("salva erro e duração zero para roteiro só com metadata sem chamar o LLM", async () => {
    const content = "# Gancho\n**Visual:** Abrir com a tela principal.\n**Nota de produção:** preparar captura.\n";
    const result = await reviewScriptForCurrentDraft("script-1", content);
    expect(mocked.completeWithFallback).not.toHaveBeenCalled();
    expect(result.qa.estimatedDurationMinutes).toBe(0);
    expect(result.qa.lintDiagnostics).toContainEqual(expect.objectContaining({ code: "script_no_audio_cues", severity: "error" }));
    expect(mocked.executeEditorialCommand).toHaveBeenCalledWith(
      { operation: "updateScript", scriptId: "script-1", content: content.trim() },
      expect.objectContaining({ qa: expect.objectContaining({ classifier: "heuristic", estimatedDurationMinutes: 0 }) }),
    );
  });
});
