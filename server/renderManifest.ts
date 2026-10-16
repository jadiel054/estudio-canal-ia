export type NarrationCue = { index: number; sectionIndex: number; section: string; text: string };
export type NarrationChunk = { index: number; cueIndices: number[]; text: string };
export type VisualDirection = { sectionIndex: number; section: string; text: string };
export type ScriptVisuals = { cues: NarrationCue[]; codeBlocks: string[]; sections: string[]; visualDirections: VisualDirection[] };
export type ScriptLintSeverity = "error" | "warning" | "info";
export type ScriptLintDiagnostic = {
  code: string;
  severity: ScriptLintSeverity;
  sectionIndex: number;
  section: string;
  lineStart: number;
  lineEnd: number;
  message: string;
  excerpt?: string;
};
export type ScriptInspection = ScriptVisuals & {
  mode: "legacy" | "marked";
  lintDiagnostics: ScriptLintDiagnostic[];
};
export const MAX_TTS_CHUNK_CHARS = 1_100;
export const MAX_SCRIPT_LINT_DIAGNOSTICS = 200;
const MAX_SCRIPT_CHARS = 100_000;
const MAX_CUE_CHARS = 180;
const MAX_CUES = 80;
const MAX_SECTIONS = 30;
const MAX_PRODUCTION_DIRECTIVES = 80;
const MAX_PRODUCTION_DIRECTIVE_CHARS = 2_000;

function cleanLine(value: string) {
  return value
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(paragraph: string): string[] {
  const text = cleanLine(paragraph);
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"“])/u).filter(Boolean);
  const result: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CUE_CHARS) { result.push(sentence); continue; }
    let pending = "";
    for (const word of sentence.split(/\s+/)) {
      if (Array.from(word).length > MAX_CUE_CHARS) throw new Error("O roteiro contém uma palavra ou URL maior que o limite legível de legenda; divida ou remova-a antes do render.");
      if (pending && `${pending} ${word}`.length > MAX_CUE_CHARS) { result.push(pending); pending = word; }
      else pending = pending ? `${pending} ${word}` : word;
    }
    if (pending) result.push(pending);
  }
  return result;
}

type DirectiveKind = "audio" | "visual" | "note";
type TextBlock = { text: string; lineStart: number; lineEnd: number };
type DirectiveBlock = TextBlock & { kind: DirectiveKind };
type ScriptSection = { title: string; paragraphs: TextBlock[]; directives: DirectiveBlock[]; hasExplicitHeading: boolean };
type ActiveDirective = { kind: DirectiveKind; lines: string[]; lineStart: number; lineEnd: number };
type Marker = { kind: DirectiveKind; text: string };
export type ScriptInspectionOptions = { captureSectionIndexes?: number[] };

function directiveMarker(line: string): Marker | null {
  const candidate = line.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "");
  const visual = /^(?:\*\*)?Visual\s*:\s*(?:\*\*)?\s*(.*)$/iu.exec(candidate);
  if (visual) return { kind: "visual", text: visual[1] };
  const audio = /^(?:\*\*)?Áudio\s*\(\s*Narração\s*\)\s*:\s*(?:\*\*)?\s*(.*)$/iu.exec(candidate);
  if (audio) return { kind: "audio", text: audio[1] };
  const note = /^(?:\*\*)?Nota\s+de\s+produção\s*:\s*(?:\*\*)?\s*(.*)$/iu.exec(candidate);
  if (note) return { kind: "note", text: note[1] };
  return null;
}

function blankVisuals(mode: ScriptInspection["mode"] = "legacy"): ScriptInspection {
  return { mode, cues: [], codeBlocks: [], sections: [], visualDirections: [], lintDiagnostics: [] };
}

function directiveDiagnostic(kind: DirectiveKind, sectionIndex: number, section: string, lineStart: number, lineEnd: number): ScriptLintDiagnostic {
  const label = kind === "audio" ? "Áudio (Narração)" : kind === "visual" ? "Visual" : "Nota de produção";
  const code = kind === "audio" ? "script_empty_audio_directive" : kind === "visual" ? "script_empty_visual_directive" : "script_empty_production_note";
  return { code, severity: "error", sectionIndex, section, lineStart, lineEnd, message: `O bloco ${label} está vazio. Adicione conteúdo ou remova o marcador.` };
}

/**
 * Analisa o roteiro sem transformar texto inválido em fala. Em modo legado, texto
 * fora de headings/code permanece narração. Em modo marcado, somente blocos
 * Áudio (Narração) geram cues; Visual e Nota são metadata e nunca são retornados
 * como texto narrável.
 */
export function inspectScript(content: unknown, options: ScriptInspectionOptions = {}): ScriptInspection {
  const diagnostics: ScriptLintDiagnostic[] = [];
  let diagnosticsTruncated = false;
  const addDiagnostic = (diagnostic: ScriptLintDiagnostic) => {
    if (diagnostics.length < MAX_SCRIPT_LINT_DIAGNOSTICS - 1) {
      diagnostics.push(diagnostic);
    } else if (!diagnosticsTruncated) {
      diagnostics.push({ code: "script_diagnostics_truncated", severity: "error", sectionIndex: 0, section: "Roteiro", lineStart: 1, lineEnd: 1, message: `O número de diagnósticos excedeu o limite seguro de ${MAX_SCRIPT_LINT_DIAGNOSTICS}; revise e divida o roteiro antes do Portão 1 ou render.` });
      diagnosticsTruncated = true;
    }
  };
  if (typeof content !== "string" || !content.trim()) {
    const empty = blankVisuals();
    empty.lintDiagnostics.push({ code: "script_empty", severity: "error", sectionIndex: 0, section: "Narração", lineStart: 1, lineEnd: 1, message: "O roteiro está vazio." });
    return empty;
  }
  if (content.length > MAX_SCRIPT_CHARS) {
    const oversized = blankVisuals();
    oversized.lintDiagnostics.push({ code: "script_too_large", severity: "error", sectionIndex: 0, section: "Narração", lineStart: 1, lineEnd: 1, message: `O roteiro é maior que o limite de ${MAX_SCRIPT_CHARS.toLocaleString("pt-BR")} caracteres.` });
    return oversized;
  }

  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const sections: ScriptSection[] = [];
  const codeBlocks: string[] = [];
  let current: ScriptSection = { title: "Narração", paragraphs: [], directives: [], hasExplicitHeading: false };
  let inCode = false;
  let code: string[] = [];
  let paragraph: string[] = [];
  let paragraphStart = 0;
  let paragraphEnd = 0;
  let codeStartLine = 0;
  let codeEndLine = 0;
  let activeDirective: ActiveDirective | null = null;
  let hasProductionMarkers = false;

  const flushParagraph = () => {
    const text = cleanLine(paragraph.join(" "));
    if (text) current.paragraphs.push({ text, lineStart: paragraphStart || paragraphEnd || 1, lineEnd: paragraphEnd || paragraphStart || 1 });
    paragraph = [];
    paragraphStart = 0;
    paragraphEnd = 0;
  };
  const flushDirective = () => {
    if (!activeDirective) return;
    const text = cleanLine(activeDirective.lines.join(" "));
    const sectionIndex = sections.length;
    if (!text) addDiagnostic(directiveDiagnostic(activeDirective.kind, sectionIndex, current.title, activeDirective.lineStart, activeDirective.lineEnd));
    if ((activeDirective.kind === "visual" || activeDirective.kind === "note") && text.length > MAX_PRODUCTION_DIRECTIVE_CHARS) {
      const isNote = activeDirective.kind === "note";
      addDiagnostic({
        code: isNote ? "script_production_note_too_long" : "script_visual_direction_too_long",
        severity: "error", sectionIndex, section: current.title, lineStart: activeDirective.lineStart, lineEnd: activeDirective.lineEnd,
        message: `${isNote ? "A Nota de produção" : "A direção Visual"} excede o limite de ${MAX_PRODUCTION_DIRECTIVE_CHARS.toLocaleString("pt-BR")} caracteres.`,
      });
    }
    current.directives.push({ kind: activeDirective.kind, text, lineStart: activeDirective.lineStart, lineEnd: activeDirective.lineEnd });
    if (activeDirective.kind === "note" && text) {
      addDiagnostic({ code: "script_production_note_non_actionable", severity: "warning", sectionIndex, section: current.title, lineStart: activeDirective.lineStart, lineEnd: activeDirective.lineEnd, message: "Nota de produção é metadata interna sem tipo de ação reconhecido; não alterará fala nem render. Use Visual: para direção visual explícita." });
    }
    activeDirective = null;
  };
  const flushSection = () => {
    flushParagraph();
    flushDirective();
    if (current.paragraphs.length || current.directives.length) sections.push(current);
  };
  const addCodeBlock = () => {
    const block = code.join("\n").trim();
    if (block) {
      codeBlocks.push(block.slice(0, 8_000));
      if (!current.hasExplicitHeading) addDiagnostic({ code: "script_code_unassociated_section", severity: "warning", sectionIndex: sections.length, section: current.title, lineStart: codeStartLine || 1, lineEnd: codeEndLine || codeStartLine || 1, message: "O bloco de código não está associado a uma seção explícita; revise a posição ou adicione um título Markdown." });
    }
    code = [];
    codeStartLine = 0;
    codeEndLine = 0;
  };

  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    const trimmed = line.trim();
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      if (inCode) addCodeBlock();
      else { flushParagraph(); flushDirective(); codeStartLine = lineNumber + 1; codeEndLine = lineNumber; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); codeEndLine = lineNumber; continue; }

    const marker = directiveMarker(trimmed);
    if (marker) {
      flushParagraph();
      flushDirective();
      hasProductionMarkers = true;
      activeDirective = { kind: marker.kind, lines: marker.text ? [marker.text] : [], lineStart: lineNumber, lineEnd: lineNumber };
      continue;
    }

    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushSection();
      current = { title: cleanLine(heading[1]).slice(0, 100) || "Narração", paragraphs: [], directives: [], hasExplicitHeading: true };
      continue;
    }
    if (!trimmed || /^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      flushDirective();
      continue;
    }
    const textLine = /^>\s?/.test(trimmed) ? trimmed.replace(/^>\s?/, "") : trimmed;
    if (activeDirective) {
      activeDirective.lines.push(textLine);
      activeDirective.lineEnd = lineNumber;
    } else {
      if (!paragraph.length) paragraphStart = lineNumber;
      paragraph.push(textLine);
      paragraphEnd = lineNumber;
    }
  }
  if (inCode && code.length) addCodeBlock();
  flushSection();

  const mode = hasProductionMarkers ? "marked" : "legacy";
  if (!hasProductionMarkers) {
    addDiagnostic({ code: "script_legacy_mode", severity: "info", sectionIndex: 0, section: sections[0]?.title ?? "Narração", lineStart: 1, lineEnd: Math.max(1, lines.length), message: "Nenhum marcador de produção foi encontrado; o texto fora de headings e blocos de código será tratado no modo legado como narração." });
  } else {
    for (const [sectionIndex, section] of sections.entries()) {
      for (const block of section.paragraphs) {
        addDiagnostic({ code: "script_unlabeled_paragraph", severity: "error", sectionIndex, section: section.title, lineStart: block.lineStart, lineEnd: block.lineEnd, message: "Texto solto em roteiro marcado. Rotule como Áudio (Narração), Visual ou Nota de produção; não será usado como fala.", excerpt: block.text.slice(0, 120) });
      }
    }
  }

  const cues: NarrationCue[] = [];
  const visualDirections: VisualDirection[] = [];
  let productionDirectiveCount = 0;
  const hasCaptureContext = Array.isArray(options.captureSectionIndexes);
  const captureSectionIndexes = new Set(options.captureSectionIndexes ?? []);
  for (const [sectionIndex, section] of sections.entries()) {
    const visualBlocks = section.directives.filter(block => block.kind === "visual" && block.text);
    const audioBlocks = section.directives.filter(block => block.kind === "audio" && block.text);
    productionDirectiveCount += section.directives.filter(block => block.kind === "visual" || block.kind === "note").length;
    for (const block of visualBlocks) visualDirections.push({ sectionIndex, section: section.title, text: block.text });
    if (hasCaptureContext && visualBlocks.length && !captureSectionIndexes.has(sectionIndex)) {
      const firstVisual = visualBlocks[0];
      addDiagnostic({ code: "script_visual_without_capture", severity: "warning", sectionIndex, section: section.title, lineStart: firstVisual.lineStart, lineEnd: firstVisual.lineEnd, message: "A direção Visual não tem captura atribuída a esta seção; o worker usará o focus frame (uma captura genérica, se houver, fica limitada ao primeiro cue)." });
    }

    if (hasProductionMarkers) {
      for (const block of audioBlocks) {
        try {
          for (const sentence of splitSentences(block.text)) if (sentence) cues.push({ index: cues.length, sectionIndex, section: section.title, text: sentence });
        } catch (error) {
          addDiagnostic({ code: "script_audio_cue_unreadable", severity: "error", sectionIndex, section: section.title, lineStart: block.lineStart, lineEnd: block.lineEnd, message: error instanceof Error ? error.message : "Um bloco de narração excede os limites de legenda." });
        }
      }
      if (audioBlocks.length && !visualBlocks.length) {
        const firstAudio = audioBlocks[0];
        addDiagnostic({ code: "script_missing_visual_direction", severity: "warning", sectionIndex, section: section.title, lineStart: firstAudio.lineStart, lineEnd: firstAudio.lineEnd, message: "Esta seção falada não tem direção Visual; o render usará o focus frame/fallback disponível." });
      }
    } else {
      for (const block of section.paragraphs) {
        try {
          for (const sentence of splitSentences(block.text)) if (sentence) cues.push({ index: cues.length, sectionIndex, section: section.title, text: sentence });
        } catch (error) {
          addDiagnostic({ code: "script_audio_cue_unreadable", severity: "error", sectionIndex, section: section.title, lineStart: block.lineStart, lineEnd: block.lineEnd, message: error instanceof Error ? error.message : "Um bloco de narração excede os limites de legenda." });
        }
      }
    }
  }

  if (!cues.length) addDiagnostic({ code: "script_no_audio_cues", severity: "error", sectionIndex: Math.max(0, sections.length - 1), section: sections.at(-1)?.title ?? "Narração", lineStart: 1, lineEnd: Math.max(1, lines.length), message: "O roteiro não contém texto de narração válido em nenhum cue de Áudio (Narração); não há conteúdo falado para revisar ou renderizar." });
  if (cues.length > MAX_CUES) addDiagnostic({ code: "script_too_many_audio_cues", severity: "error", sectionIndex: cues[MAX_CUES]?.sectionIndex ?? 0, section: cues[MAX_CUES]?.section ?? "Narração", lineStart: 1, lineEnd: Math.max(1, lines.length), message: `O roteiro excede o limite seguro de ${MAX_CUES} trechos de narração; divida-o em partes antes do render.` });
  if (visualDirections.length > MAX_PRODUCTION_DIRECTIVES || productionDirectiveCount > MAX_PRODUCTION_DIRECTIVES) {
    addDiagnostic({ code: "script_too_many_production_directives", severity: "error", sectionIndex: 0, section: sections[0]?.title ?? "Narração", lineStart: 1, lineEnd: Math.max(1, lines.length), message: `O roteiro excede o limite seguro de ${MAX_PRODUCTION_DIRECTIVES} direções/notas de produção.` });
  }
  if (sections.length > MAX_SECTIONS) addDiagnostic({ code: "script_too_many_sections", severity: "error", sectionIndex: MAX_SECTIONS, section: sections[MAX_SECTIONS]?.title ?? "Narração", lineStart: 1, lineEnd: Math.max(1, lines.length), message: `O roteiro excede o limite seguro de ${MAX_SECTIONS} seções.` });
  for (const sectionIndex of options.captureSectionIndexes ?? []) {
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= sections.length) {
      addDiagnostic({ code: "script_capture_section_index_invalid", severity: "error", sectionIndex: Number.isInteger(sectionIndex) && sectionIndex >= 0 ? sectionIndex : 0, section: "Seção de captura", lineStart: 1, lineEnd: Math.max(1, lines.length), message: "Uma captura atribuída aponta para sectionIndex fora das seções atuais do roteiro. Corrija o vínculo antes do Portão 1 ou render." });
    }
  }

  const severityOrder: Record<ScriptLintSeverity, number> = { error: 0, warning: 1, info: 2 };
  diagnostics.sort((left, right) => left.lineStart - right.lineStart || severityOrder[left.severity] - severityOrder[right.severity] || left.code.localeCompare(right.code));
  return {
    mode,
    cues,
    codeBlocks: codeBlocks.slice(0, 12),
    sections: sections.map(section => section.title).slice(0, MAX_SECTIONS),
    visualDirections,
    lintDiagnostics: diagnostics,
  };
}

export function lintScript(content: unknown, options: ScriptInspectionOptions = {}) {
  const inspection = inspectScript(content, options);
  return { mode: inspection.mode, diagnostics: inspection.lintDiagnostics };
}

export function assertScriptRenderable(content: unknown): ScriptVisuals {
  const inspection = inspectScript(content);
  const errors = inspection.lintDiagnostics.filter(diagnostic => diagnostic.severity === "error");
  if (errors.length) {
    const detail = errors.slice(0, 5).map(diagnostic => `${diagnostic.code} (seção ${diagnostic.sectionIndex + 1}, linhas ${diagnostic.lineStart}–${diagnostic.lineEnd}): ${diagnostic.message}`).join("; ");
    throw new Error(`Lint bloqueante do roteiro: ${detail}. Corrija os erros antes do Portão 1 ou do render.`);
  }
  return { cues: inspection.cues, codeBlocks: inspection.codeBlocks, sections: inspection.sections, visualDirections: inspection.visualDirections };
}

/** Compatibility API: returns renderable visuals, and refuses every blocking lint error. */
export function extractScriptVisuals(content: string): ScriptVisuals {
  return assertScriptRenderable(content);
}

/** Agrupa cues inteiros em blocos de fala para reduzir chamadas mantendo a legenda por frase. */
export function buildNarrationChunks(cues: NarrationCue[], maxChars = MAX_TTS_CHUNK_CHARS): NarrationChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < MAX_CUE_CHARS || maxChars > 2_000) throw new Error("Limite de bloco TTS inválido.");
  if (!Array.isArray(cues) || cues.length < 1 || cues.length > MAX_CUES) throw new Error("Quantidade de cues fora dos limites para agrupamento TTS.");
  const chunks: NarrationChunk[] = [];
  let textParts: string[] = [];
  let cueIndices: number[] = [];
  let chars = 0;
  const flush = () => {
    if (!cueIndices.length) return;
    chunks.push({ index: chunks.length, cueIndices, text: textParts.join(" ") });
    textParts = [];
    cueIndices = [];
    chars = 0;
  };
  for (const cue of cues) {
    if (!Number.isInteger(cue.index) || cue.index < 0 || typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > maxChars) throw new Error("Cue TTS inválido para agrupamento.");
    const nextChars = chars + (chars ? 1 : 0) + cue.text.length;
    if (cueIndices.length && nextChars > maxChars) flush();
    textParts.push(cue.text.trim());
    cueIndices.push(cue.index);
    chars += (chars ? 1 : 0) + cue.text.trim().length;
  }
  flush();
  return chunks;
}

export function formatSrtTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
