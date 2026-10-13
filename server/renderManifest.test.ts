import { describe, expect, it } from "vitest";
import { extractScriptVisuals, formatSrtTimestamp } from "./renderManifest";

describe("render manifest script extraction", () => {
  it("separates headings, captions and code without rewriting spoken text", () => {
    const result = extractScriptVisuals(`# Gancho\nOlá, devs! Vamos testar.\n\n# Demonstração\nAbra o terminal e rode o comando.\n\n\`\`\`ts\nconst ok = true;\n\`\`\``);
    expect(result.sections).toEqual(["Gancho", "Demonstração"]);
    expect(result.cues.map(cue => cue.text)).toEqual(["Olá, devs!", "Vamos testar.", "Abra o terminal e rode o comando."]);
    expect(result.codeBlocks).toEqual(["const ok = true;"]);
  });

  it("rejects code-only scripts and scripts with too many cues instead of speaking code or truncating", () => {
    expect(() => extractScriptVisuals("```ts\nconst secret = 1;\n```" )).toThrow("não contém texto de narração");
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

describe("SRT timestamps", () => {
  it("formats milliseconds and timestamps longer than one hour", () => {
    expect(formatSrtTimestamp(1.234)).toBe("00:00:01,234");
    expect(formatSrtTimestamp(3_661.005)).toBe("01:01:01,005");
    expect(formatSrtTimestamp(-2)).toBe("00:00:00,000");
  });
});
