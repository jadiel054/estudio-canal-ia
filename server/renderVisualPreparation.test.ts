import { describe, expect, it, vi } from "vitest";
import { prepareRenderVisuals } from "./renderPipeline";

describe("preparação visual do render", () => {
  it("deriva Visual por seção e preserva o fallback quando a política está desligada", async () => {
    const generate = vi.fn(async (input: any) => ({ status: "disabled" as const, reason: "feature_disabled", cacheKey: "cache", promptHash: "hash" }));
    const result = await prepareRenderVisuals({
      scriptContent: "# Abertura\n**Áudio (Narração):** Fala.\n**Visual:** Terminal com teste passando.\n\n# Fecho\n**Áudio (Narração):** Fim.\n**Visual:** Gráfico simples.",
      videoId: "video-id",
      jobId: "job-id",
      format: "Longo",
      adapter: { generate },
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0]).toMatchObject({ visualDirection: "Terminal com teste passando.", width: 1280, height: 720, sectionIndex: 0 });
    expect(result).toEqual([
      { sectionIndex: 0, status: "disabled", reason: "feature_disabled" },
      { sectionIndex: 1, status: "disabled", reason: "feature_disabled" },
    ]);
  });

  it("não propaga erro do adapter para impedir o render", async () => {
    const result = await prepareRenderVisuals({
      scriptContent: "# Seção\n**Áudio (Narração):** Fala.\n**Visual:** Uma imagem.",
      videoId: "video-id",
      jobId: "job-id",
      format: "Short",
      adapter: { generate: vi.fn(async () => { throw new Error("provider secret must not escape"); }) },
    });
    expect(result).toEqual([{ sectionIndex: 0, status: "unavailable", reason: "preparation_failed" }]);
  });
});
