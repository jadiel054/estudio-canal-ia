import { describe, expect, it } from "vitest";
import { seedState } from "../client/src/data/studio";
import { parseStudioState } from "./studioStateSchema";

/**
 * Garante que o conjunto de demonstração enviado pelo cliente passa na mesma
 * validação usada por `studio.saveState` e `studio.importState`. Sem isso, o
 * primeiro salvamento do aparelho falharia e nada seria persistido no Neon.
 */
describe("estado de demonstração", () => {
  it("passa na validação usada por saveState e importState", () => {
    const parsed = parseStudioState(seedState);
    expect(parsed.ideas).toHaveLength(seedState.ideas.length);
    expect(parsed.scripts).toHaveLength(seedState.scripts.length);
    expect(parsed.videos).toHaveLength(seedState.videos.length);
    expect(parsed.settings.demoMode).toBe(false);
  });

  it("marca todo item de demonstração com example: true", () => {
    for (const collection of ["trends", "ideas", "scripts", "assets", "videos", "renderJobs", "adapters", "audit", "chat"] as const) {
      const items = seedState[collection] as Array<{ example?: boolean }>;
      expect(items.length, collection).toBeGreaterThan(0);
      expect(items.every(item => item.example === true), collection).toBe(true);
    }
  });

  it("não apresenta QA aprovado em vídeo simulado", () => {
    const simulated = seedState.videos.filter(video => video.simulated);
    expect(simulated.length).toBeGreaterThan(0);
    for (const video of simulated) {
      expect(video.qa.every(item => item.passed === false && item.verified === false)).toBe(true);
    }
  });
});