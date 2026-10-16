import { describe, expect, it } from "vitest";
import { buildNarrationChunks, extractScriptVisuals, formatSrtTimestamp } from "./renderManifest";

describe("render manifest script extraction", () => {
  it("separates headings, captions and code without rewriting spoken text", () => {
    const result = extractScriptVisuals(`# Gancho\nOlá, devs! Vamos testar.\n\n# Demonstração\nAbra o terminal e rode o comando.\n\n\`\`\`ts\nconst ok = true;\n\`\`\``);
    expect(result.sections).toEqual(["Gancho", "Demonstração"]);
    expect(result.cues.map(cue => cue.text)).toEqual(["Olá, devs!", "Vamos testar.", "Abra o terminal e rode o comando."]);
    expect(result.cues.map(cue => cue.sectionIndex)).toEqual([0, 0, 1]);
    expect(result.codeBlocks).toEqual(["const ok = true;"]);
    expect(result.visualDirections).toEqual([]);
  });

  it("continues treating an unmarked script as legacy narration", () => {
    const result = extractScriptVisuals("# Gancho\nUma fala de roteiro sem marcadores permanece narração.\n\n# Fecho\nOutra fala legado.");
    expect(result.cues.map(cue => cue.text)).toEqual([
      "Uma fala de roteiro sem marcadores permanece narração.",
      "Outra fala legado.",
    ]);
    expect(result.visualDirections).toEqual([]);
  });

  it("fala somente os blocos de Áudio e associa Visual à seção sem o incluir em TTS ou captions", () => {
    const result = extractScriptVisuals([
      "# Gancho",
      "**Visual:** Close-up do mapa vetorial na tela; destacar os nós relacionados.",
      "**Áudio (Narração):** Embeddings transformam cada trecho em uma representação vetorial.",
      "Elas permitem comparar o sentido entre textos.",
      "",
      "# Demonstração",
      "Visual: Mostrar a busca semântica e o resultado encontrado.",
      "Áudio (Narração): Agora compare a busca por palavra com a busca por significado.",
      "```ts",
      "const visualNoteMustNotBeSpoken = true;",
      "```",
    ].join("\n"));

    expect(result.sections).toEqual(["Gancho", "Demonstração"]);
    expect(result.cues.map(cue => cue.text)).toEqual([
      "Embeddings transformam cada trecho em uma representação vetorial.",
      "Elas permitem comparar o sentido entre textos.",
      "Agora compare a busca por palavra com a busca por significado.",
    ]);
    expect(result.cues.map(cue => cue.sectionIndex)).toEqual([0, 0, 1]);
    expect(result.visualDirections).toEqual([
      { sectionIndex: 0, section: "Gancho", text: "Close-up do mapa vetorial na tela; destacar os nós relacionados." },
      { sectionIndex: 1, section: "Demonstração", text: "Mostrar a busca semântica e o resultado encontrado." },
    ]);
    const speech = buildNarrationChunks(result.cues).map(chunk => chunk.text).join(" ");
    expect(speech).not.toContain("Close-up");
    expect(speech).not.toContain("Mostrar a busca semântica");
    expect(speech).not.toContain("visualNoteMustNotBeSpoken");
  });

  it("rejects code-only scripts and scripts with too many cues instead of speaking code or truncating", () => {
    expect(() => extractScriptVisuals("\`\`\`ts\nconst secret = 1;\n\`\`\`" )).toThrow("não contém texto de narração");
    const many = Array.from({ length: 81 }, (_, index) => `Frase número ${index + 1}.`).join(" ");
    expect(() => extractScriptVisuals(many)).toThrow("excede o limite seguro");
  });

  it("enforces the existing script size limit", () => {
    expect(() => extractScriptVisuals("a".repeat(100_001))).toThrow("maior que o limite");
  });

  it("splits long narration into readable captions and rejects an oversized unbroken token", () => {
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
