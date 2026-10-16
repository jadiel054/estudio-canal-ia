import { describe, expect, it } from "vitest";
import { assertScriptRenderable, buildNarrationChunks, extractScriptVisuals, formatSrtTimestamp, inspectScript, lintScript } from "./renderManifest";

describe("parser e lint do roteiro", () => {
  it("separa headings, fala e código sem reescrever a narração no modo legado", () => {
    const inspection = inspectScript(`# Gancho\nOlá, devs! Vamos testar.\n\n# Demonstração\nAbra o terminal e rode o comando.\n\n\`\`\`ts\nconst ok = true;\n\`\`\``);
    expect(inspection.mode).toBe("legacy");
    expect(inspection.sections).toEqual(["Gancho", "Demonstração"]);
    expect(inspection.cues.map(cue => cue.text)).toEqual(["Olá, devs!", "Vamos testar.", "Abra o terminal e rode o comando."]);
    expect(inspection.cues.map(cue => cue.sectionIndex)).toEqual([0, 0, 1]);
    expect(inspection.codeBlocks).toEqual(["const ok = true;"]);
    expect(inspection.visualDirections).toEqual([]);
    expect(inspection.lintDiagnostics).toContainEqual(expect.objectContaining({ code: "script_legacy_mode", severity: "info" }));
  });

  it("continua tratando roteiro sem marcadores como narração legada", () => {
    const result = extractScriptVisuals("# Gancho\nUma fala de roteiro sem marcadores permanece narração.\n\n# Fecho\nOutra fala legado.");
    expect(result.cues.map(cue => cue.text)).toEqual(["Uma fala de roteiro sem marcadores permanece narração.", "Outra fala legado."]);
    expect(result.visualDirections).toEqual([]);
  });

  it("reconhece Nota, Visual e Áudio (Narração), mas só emite fala e Visual no manifesto", () => {
    const privateNote = "NOTA_INTERNA_CONFIDENCIAL_DO_EDITOR";
    const inspection = inspectScript([
      "# Gancho",
      `**Nota de produção:** ${privateNote}`,
      "**Visual:** Close-up do mapa vetorial na tela; destacar os nós relacionados.",
      "**Áudio (Narração):** Embeddings transformam cada trecho em uma representação vetorial.",
      "Elas permitem comparar o sentido entre textos.",
      "",
      "# Demonstração",
      "Nota de produção: ocultar credenciais antes da captura.",
      "Visual: Mostrar a busca semântica e o resultado encontrado.",
      "Áudio (Narração): Agora compare a busca por palavra com a busca por significado.",
      "```ts",
      "const markerInsideCode = '**Nota de produção:** não é uma nota';",
      "```",
    ].join("\n"));

    expect(inspection.mode).toBe("marked");
    expect(inspection.sections).toEqual(["Gancho", "Demonstração"]);
    expect(inspection.cues.map(cue => cue.text)).toEqual([
      "Embeddings transformam cada trecho em uma representação vetorial.",
      "Elas permitem comparar o sentido entre textos.",
      "Agora compare a busca por palavra com a busca por significado.",
    ]);
    expect(inspection.cues.map(cue => cue.sectionIndex)).toEqual([0, 0, 1]);
    expect(inspection.visualDirections).toEqual([
      { sectionIndex: 0, section: "Gancho", text: "Close-up do mapa vetorial na tela; destacar os nós relacionados." },
      { sectionIndex: 1, section: "Demonstração", text: "Mostrar a busca semântica e o resultado encontrado." },
    ]);
    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain(privateNote);
    expect(serialized).not.toContain("ocultar credenciais");
    expect(inspection.codeBlocks).toContain("const markerInsideCode = '**Nota de produção:** não é uma nota';");
    expect(inspection.lintDiagnostics.filter(item => item.code === "script_production_note_non_actionable" && item.severity === "warning")).toHaveLength(2);
    const speech = buildNarrationChunks(inspection.cues).map(chunk => chunk.text).join(" ");
    expect(speech).not.toContain("Close-up");
    expect(speech).not.toContain("Mostrar a busca semântica");
    expect(speech).not.toContain("NOTA_INTERNA");
  });

  it("bloqueia parágrafos soltos antes, entre e depois dos blocos em modo marcado", () => {
    const inspection = inspectScript([
      "Parágrafo solto antes.",
      "",
      "# Demonstração",
      "**Áudio (Narração):** Primeira fala válida.",
      "",
      "Parágrafo solto entre blocos.",
      "",
      "**Visual:** Exibir o painel de resultados.",
      "**Áudio (Narração):** Segunda fala válida.",
      "",
      "Parágrafo solto depois.",
    ].join("\n"));
    const unlabeled = inspection.lintDiagnostics.filter(item => item.code === "script_unlabeled_paragraph");
    expect(unlabeled).toHaveLength(3);
    expect(unlabeled.map(item => item.severity)).toEqual(["error", "error", "error"]);
    expect(unlabeled.map(item => item.sectionIndex)).toEqual([0, 1, 1]);
    expect(unlabeled[0].excerpt).toBe("Parágrafo solto antes.");
    expect(inspection.cues.map(cue => cue.text)).toEqual(["Primeira fala válida.", "Segunda fala válida."]);
    expect(() => assertScriptRenderable(inspection.mode === "marked" ? [
      "Parágrafo solto antes.", "", "# Demonstração", "**Áudio (Narração):** Primeira fala válida.", "", "Parágrafo solto entre blocos.", "", "**Visual:** Exibir o painel de resultados.", "**Áudio (Narração):** Segunda fala válida.", "", "Parágrafo solto depois.",
    ].join("\n") : "")).toThrow("script_unlabeled_paragraph");
  });

  it("bloqueia roteiro marcado sem cue falado e sinaliza seção sem Visual como warning", () => {
    const onlyMetadata = lintScript("# Gancho\n**Visual:** Mostrar um mapa vetorial.\n**Nota de produção:** sem fala.");
    expect(onlyMetadata.diagnostics).toContainEqual(expect.objectContaining({ code: "script_no_audio_cues", severity: "error" }));
    expect(() => assertScriptRenderable("# Gancho\n**Visual:** Mostrar um mapa vetorial.\n**Nota de produção:** sem fala.")).toThrow("script_no_audio_cues");

    const missingVisual = lintScript("# Gancho\n**Áudio (Narração):** Esta fala não tem direção visual.");
    expect(missingVisual.diagnostics).toContainEqual(expect.objectContaining({ code: "script_missing_visual_direction", severity: "warning", sectionIndex: 0 }));
    expect(() => assertScriptRenderable("# Gancho\n**Áudio (Narração):** Esta fala não tem direção visual.")).not.toThrow();
  });

  it("avisa Visual sem captura atribuída e bloqueia sectionIndex de captura fora do manifesto", () => {
    const content = "# Gancho\n**Visual:** Mostrar o painel.\n**Áudio (Narração):** Uma fala curta.";
    const withoutCapture = lintScript(content, { captureSectionIndexes: [] });
    expect(withoutCapture.diagnostics).toContainEqual(expect.objectContaining({ code: "script_visual_without_capture", severity: "warning", sectionIndex: 0 }));
    const withCapture = lintScript(content, { captureSectionIndexes: [0] });
    expect(withCapture.diagnostics.some(item => item.code === "script_visual_without_capture")).toBe(false);
    const invalidCapture = lintScript(content, { captureSectionIndexes: [2] });
    expect(invalidCapture.diagnostics).toContainEqual(expect.objectContaining({ code: "script_capture_section_index_invalid", severity: "error" }));
  });

  it("retorna diagnostics estáveis para marcadores vazios e aceita o modo legado sem mudar sua semântica", () => {
    const diagnostics = lintScript("# Gancho\n**Visual:**\n\n**Nota de produção:**\n\n**Áudio (Narração):** Uma fala.").diagnostics;
    expect(diagnostics.map(item => item.code)).toContain("script_empty_visual_directive");
    expect(diagnostics.map(item => item.code)).toContain("script_empty_production_note");
    expect(diagnostics.filter(item => item.severity === "error").every(item => Number.isInteger(item.sectionIndex) && item.lineStart > 0 && item.lineEnd >= item.lineStart)).toBe(true);

    const legacy = lintScript("Texto livre legado.");
    expect(legacy.mode).toBe("legacy");
    expect(legacy.diagnostics).toEqual([expect.objectContaining({ code: "script_legacy_mode", severity: "info" })]);
  });

  it("aplica limites de 2.000 caracteres em Visual/Nota e o limite de diretivas de produção", () => {
    expect(lintScript(`**Visual:** ${"x".repeat(2_001)}\n**Áudio (Narração):** Fala válida.`).diagnostics).toContainEqual(expect.objectContaining({ code: "script_visual_direction_too_long", severity: "error" }));
    expect(lintScript(`**Nota de produção:** ${"x".repeat(2_001)}\n**Áudio (Narração):** Fala válida.`).diagnostics).toContainEqual(expect.objectContaining({ code: "script_production_note_too_long", severity: "error" }));
    const manyNotes = Array.from({ length: 81 }, (_, index) => `**Nota de produção:** Nota ${index + 1}.`).join("\n\n");
    expect(lintScript(`${manyNotes}\n\n**Áudio (Narração):** Fala válida.`).diagnostics).toContainEqual(expect.objectContaining({ code: "script_too_many_production_directives", severity: "error" }));
  });

  it("limita diagnostics persistidos e bloqueia explicitamente quando o limite é excedido", () => {
    const paragraphs = Array.from({ length: 250 }, (_, index) => `Texto solto ${index + 1}.`).join("\n\n");
    const diagnostics = lintScript(`**Áudio (Narração):** Fala inicial.\n\n${paragraphs}`).diagnostics;
    expect(diagnostics).toHaveLength(200);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "script_diagnostics_truncated", severity: "error" }));
  });

  it("ignora marcadores dentro de bloco de código e mantém o modo legado", () => {
    const inspection = inspectScript("```md\n**Nota de produção:** isso é código\n```\nTexto narrado legado.");
    expect(inspection.mode).toBe("legacy");
    expect(inspection.cues.map(cue => cue.text)).toEqual(["Texto narrado legado."]);
    expect(inspection.codeBlocks).toEqual(["**Nota de produção:** isso é código"]);
    expect(inspection.lintDiagnostics.map(item => item.code)).toEqual(["script_legacy_mode", "script_code_unassociated_section"]);
  });

  it("rejeita roteiro apenas com código, mais de 80 cues e texto acima do limite", () => {
    expect(() => extractScriptVisuals("```ts\nconst secret = 1;\n```" )).toThrow("não contém texto de narração");
    const many = Array.from({ length: 81 }, (_, index) => `Frase número ${index + 1}.`).join(" ");
    expect(() => extractScriptVisuals(many)).toThrow("excede o limite seguro");
    expect(() => extractScriptVisuals("a".repeat(100_001))).toThrow("maior que o limite");
  });

  it("divide falas longas em cues legíveis e rejeita token indivisível acima do limite", () => {
    const result = extractScriptVisuals(`${"palavra ".repeat(40).trim()}.`);
    expect(result.cues.length).toBeGreaterThan(1);
    expect(result.cues.every(cue => cue.text.length <= 180)).toBe(true);
    expect(() => extractScriptVisuals(`${"x".repeat(181)}.`)).toThrow("maior que o limite legível");
  });
});

describe("TTS chunk planning", () => {
  it("groups many caption cues into roughly 800–1,200 character calls without losing caption mappings", () => {
    const cues = Array.from({ length: 20 }, (_, index) => ({ index, sectionIndex: index < 10 ? 0 : 1, section: index < 10 ? "A" : "B", text: `Frase técnica número ${index + 1} sobre uma integração que vamos validar com cuidado.` }));
    const chunks = buildNarrationChunks(cues);
    expect(chunks.length).toBeLessThan(cues.length);
    expect(chunks.map(chunk => chunk.cueIndices).flat()).toEqual(cues.map(cue => cue.index));
    expect(chunks.every(chunk => chunk.text.length <= 1_100)).toBe(true);
    expect(chunks.every(chunk => chunk.cueIndices.length > 1)).toBe(true);
  });

  it("keeps a cue whole and rejects invalid chunk settings", () => {
    const cues = [{ index: 0, sectionIndex: 0, section: "Gancho", text: "Uma fala curta." }];
    expect(buildNarrationChunks(cues)).toEqual([{ index: 0, cueIndices: [0], text: "Uma fala curta." }]);
    expect(() => buildNarrationChunks(cues, 100)).toThrow("Limite de bloco TTS inválido");
    expect(() => buildNarrationChunks([])).toThrow("Quantidade de cues fora dos limites");
  });
});

describe("SRT timestamps", () => {
  it("formats milliseconds and timestamps longer than one hour", () => {
    expect(formatSrtTimestamp(1.234)).toBe("00:00:01,234");
    expect(formatSrtTimestamp(3_661.005)).toBe("01:01:01,005");
    expect(formatSrtTimestamp(-2)).toBe("00:00:00,000");
  });
});
