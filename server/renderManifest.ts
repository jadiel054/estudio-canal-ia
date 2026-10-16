export type NarrationCue = { index: number; sectionIndex: number; section: string; text: string };
export type NarrationChunk = { index: number; cueIndices: number[]; text: string };
export type VisualDirection = { sectionIndex: number; section: string; text: string };
export type ScriptVisuals = { cues: NarrationCue[]; codeBlocks: string[]; sections: string[]; visualDirections: VisualDirection[] };
export const MAX_TTS_CHUNK_CHARS = 1_100;
const MAX_CUE_CHARS = 180;
const MAX_CUES = 80;
const MAX_VISUAL_DIRECTIONS = 80;
const MAX_VISUAL_DIRECTION_CHARS = 2_000;

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

type ScriptSection = { title: string; paragraphs: string[]; audioBlocks: string[]; visualBlocks: string[] };
type ActiveDirective = { kind: "audio" | "visual"; lines: string[] };

function directiveMarker(line: string): { kind: "audio" | "visual"; text: string } | null {
  const candidate = line.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "");
  const visual = /^(?:\*\*)?Visual\s*:\s*(?:\*\*)?\s*(.*)$/iu.exec(candidate);
  if (visual) return { kind: "visual", text: visual[1] };
  const audio = /^(?:\*\*)?Áudio\s*\(\s*Narração\s*\)\s*:\s*(?:\*\*)?\s*(.*)$/iu.exec(candidate);
  if (audio) return { kind: "audio", text: audio[1] };
  return null;
}

/**
 * Roteiros legados sem marcadores continuam sendo tratados como antes: todo texto
 * fora de headings/code vira narração. Se aparecer qualquer marcador de produção,
 * apenas Áudio (Narração) vira cue; Visual é metadata indexada pela seção.
 */
export function extractScriptVisuals(content: string): ScriptVisuals {
  if (typeof content !== "string" || !content.trim() || content.length > 100_000) throw new Error("Roteiro vazio ou maior que o limite aceito para render.");
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const sections: ScriptSection[] = [];
  const codeBlocks: string[] = [];
  let current: ScriptSection = { title: "Narração", paragraphs: [], audioBlocks: [], visualBlocks: [] };
  let inCode = false;
  let code: string[] = [];
  let paragraph: string[] = [];
  let activeDirective: ActiveDirective | null = null;
  let hasDirectionMarkers = false;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) current.paragraphs.push(text);
    paragraph = [];
  };
  const flushDirective = () => {
    if (!activeDirective) return;
    const text = cleanLine(activeDirective.lines.join(" "));
    if (activeDirective.kind === "visual" && text.length > MAX_VISUAL_DIRECTION_CHARS) throw new Error("Uma nota de direção excede o limite aceito para o manifesto.");
    if (text) {
      if (activeDirective.kind === "audio") current.audioBlocks.push(text);
      else current.visualBlocks.push(text);
    }
    activeDirective = null;
  };
  const flushSection = () => {
    flushParagraph();
    flushDirective();
    if (current.paragraphs.length || current.audioBlocks.length || current.visualBlocks.length) sections.push(current);
  };
  const addCodeBlock = () => {
    const block = code.join("\n").trim();
    if (block) codeBlocks.push(block.slice(0, 8_000));
    code = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      if (inCode) addCodeBlock();
      else { flushParagraph(); flushDirective(); }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }

    const marker = directiveMarker(trimmed);
    if (marker) {
      flushParagraph();
      flushDirective();
      hasDirectionMarkers = true;
      activeDirective = { kind: marker.kind, lines: marker.text ? [marker.text] : [] };
      continue;
    }

    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushSection();
      current = { title: cleanLine(heading[1]).slice(0, 100) || "Narração", paragraphs: [], audioBlocks: [], visualBlocks: [] };
      continue;
    }
    if (!trimmed || /^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      flushDirective();
      continue;
    }
    const textLine = /^>\s?/.test(trimmed) ? trimmed.replace(/^>\s?/, "") : trimmed;
    if (activeDirective) activeDirective.lines.push(textLine);
    else paragraph.push(textLine);
  }
  if (inCode && code.length) addCodeBlock();
  flushSection();
  if (!sections.length) throw new Error("O roteiro aprovado não contém texto de narração fora dos blocos de código.");

  const cues: NarrationCue[] = [];
  const visualDirections: VisualDirection[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    for (const text of section.visualBlocks) visualDirections.push({ sectionIndex, section: section.title, text });
    const narrationBlocks = hasDirectionMarkers ? section.audioBlocks : section.paragraphs;
    for (const paragraphText of narrationBlocks) {
      for (const sentence of splitSentences(paragraphText)) {
        if (sentence) cues.push({ index: cues.length, sectionIndex, section: section.title, text: sentence });
      }
    }
  }
  if (!cues.length) throw new Error("O roteiro aprovado não contém texto de narração fora dos blocos de código.");
  if (cues.length > MAX_CUES) throw new Error(`O roteiro excede o limite seguro de ${MAX_CUES} trechos de narração; divida-o em partes antes do render.`);
  if (visualDirections.length > MAX_VISUAL_DIRECTIONS) throw new Error(`O roteiro excede o limite seguro de ${MAX_VISUAL_DIRECTIONS} direções visuais; reduza as notas antes do render.`);
  return {
    cues,
    codeBlocks: codeBlocks.slice(0, 12),
    sections: sections.map(section => section.title).slice(0, 30),
    visualDirections,
  };
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
