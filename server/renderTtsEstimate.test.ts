import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ value: null as any }));
const cachedKeys = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock("./studioRepository", () => ({
  getStudioState: async () => testState.value,
  getStudioPool: () => undefined,
  stateVersion: () => 0,
}));
vi.mock("./renderManifest", () => ({
  extractScriptVisuals: () => ({
    cues: [
      { index: 0, section: "A", text: "Primeiro bloco." },
      { index: 1, section: "A", text: "Segundo bloco." },
    ],
    codeBlocks: [],
    sections: ["A"],
    visualDirections: [],
  }),
  buildNarrationChunks: (cues: Array<{ index: number; text: string }>) => cues.map(cue => ({ index: cue.index, cueIndices: [cue.index], text: cue.text })),
}));
vi.mock("./ttsProvider", () => ({
  generateSpeechCached: vi.fn(),
  getTtsSettings: async () => ({ primaryModel: "gemini-3.8-flash-tts", fallbackModel: "gemini-3.8-flash-lite-tts", voice: "Kore" }),
  MAX_TTS_ATTEMPTS_PER_MODEL: 3,
  TTS_NARRATION_STYLE: "PT-BR natural",
}));
vi.mock("./ttsCache", () => ({
  getCachedTtsKeys: async () => cachedKeys.value,
  ttsAudioCacheKey: (value: { text: string; model: string; voice: string; style: string }) => JSON.stringify([value.text, value.model, value.voice, value.style]),
}));

import { estimateRenderTtsCalls } from "./renderPipeline";

describe("estimativa prévia de chamadas TTS", () => {
  beforeEach(() => {
    cachedKeys.value = new Set();
    testState.value = {
      settings: { voiceMode: "TTS" },
      ideas: [{ id: "idea-1", example: false, title: "Pauta real" }],
      scripts: [{ ideaId: "idea-1", example: false, status: "Aprovado", qa: true, content: "conteúdo omitido" }],
    };
  });

  it("subtrai blocos em cache e mostra o pior caso de fallback/retries", async () => {
    cachedKeys.value = new Set([JSON.stringify(["Primeiro bloco.", "gemini-3.8-flash-tts", "Kore", "PT-BR natural"])]);
    await expect(estimateRenderTtsCalls("idea-1")).resolves.toMatchObject({
      voiceMode: "TTS", captionCount: 2, chunkCount: 2, cacheHits: 1, estimatedCalls: 1, maxPossibleCalls: 6,
      primaryModel: "gemini-3.8-flash-tts", fallbackModel: "gemini-3.8-flash-lite-tts",
    });
  });
});
