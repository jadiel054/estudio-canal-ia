import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  let state: any;
  return {
    get state() { return state; },
    set state(value: any) { state = value; },
    getStudioState: vi.fn(async () => state),
    saveStudioState: vi.fn(async (value: any) => { state = value; return value; }),
    appendStudioAudit: vi.fn(async () => ({ persisted: true, mode: "neon" })),
  };
});
vi.mock("./studioRepository", () => mocked);

import { executeEditorialCommand } from "./editorial";

function baseState() {
  return {
    ideas: [{ id: "idea-1", title: "Pauta", format: "Longo", status: "aguarda_aprov_roteiro" }],
    scripts: [{ id: "script-1", ideaId: "idea-1", title: "Pauta", status: "Aguardando aprovação", version: 1, content: "texto" }],
    videos: [], assets: [], renderJobs: [], audit: [], settings: { automation: { publicacao: "Manual" } },
  };
}

describe("editorial commands", () => {
  beforeEach(() => { mocked.state = baseState(); mocked.saveStudioState.mockClear(); });

  it("rejects Portão 1 approval when the server state is not eligible", async () => {
    mocked.state.ideas[0].status = "pesquisa";
    await expect(executeEditorialCommand({ operation: "approveScript", ideaId: "idea-1" })).rejects.toThrow("Portão 1");
    expect(mocked.saveStudioState).not.toHaveBeenCalled();
  });

  it("persists Portão 1 approval only after server validation", async () => {
    const result: any = await executeEditorialCommand({ operation: "approveScript", ideaId: "idea-1" });
    expect(result.ideas[0].status).toBe("assets");
    expect(result.scripts[0].status).toBe("Aprovado");
    expect(mocked.saveStudioState).toHaveBeenCalledTimes(1);
  });

  it("rejects final approval when QA is absent or the video is in the wrong stage", async () => {
    mocked.state.ideas[0].status = "aguarda_aprov_video";
    mocked.state.scripts[0].status = "Aprovado";
    mocked.state.videos = [{ id: "video-1", ideaId: "idea-1", scriptId: "script-1", title: "Vídeo", stage: "qa", qa: [{ label: "QA", passed: true }] }];
    await expect(executeEditorialCommand({ operation: "approveVideo", videoId: "video-1", overrideQa: false })).rejects.toThrow("Portão 2");
    expect(mocked.saveStudioState).not.toHaveBeenCalled();
  });

  it("requires Portão 1 before starting render", async () => {
    mocked.state.ideas[0].status = "pesquisa";
    await expect(executeEditorialCommand({ operation: "startRender", ideaId: "idea-1" })).rejects.toThrow("Render exige");
    expect(mocked.saveStudioState).not.toHaveBeenCalled();
  });
});
