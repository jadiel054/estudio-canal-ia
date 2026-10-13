import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Repositório simulado que reproduz o comportamento real de concorrência:
 * `getStudioState` devolve uma cópia (como o JSON vindo do Postgres) e
 * `saveStudioState` só grava quando a versão esperada ainda é a atual.
 */
const mocked = vi.hoisted(() => {
  let state: any;
  return {
    get state() { return state; },
    set state(value: any) { state = value; },
    getStudioState: vi.fn(async () => (state ? JSON.parse(JSON.stringify(state)) : null)),
    saveStudioState: vi.fn(async (value: any, options: { expectedVersion?: number } = {}) => {
      const current = Number.isSafeInteger(state?.version) && state.version > 0 ? state.version : 0;
      if (options.expectedVersion !== undefined && options.expectedVersion !== current) {
        const error = new Error("Conflito de concorrência: outra operação salvou o estado do estúdio ao mesmo tempo. Recarregue a tela e repita a ação.");
        error.name = "StateConflictError";
        throw error;
      }
      state = { ...value, version: current + 1 };
      return state;
    }),
    appendStudioAudit: vi.fn(async () => ({ persisted: true, mode: "neon" })),
    stateVersion: (value: any) => (Number.isSafeInteger(value?.version) && value.version > 0 ? value.version : 0),
  };
});
vi.mock("./studioRepository", () => mocked);

import { executeEditorialCommand } from "./editorial";

function baseState() {
  return {
    version: 1,
    ideas: [{ id: "idea-1", title: "Pauta", format: "Longo", status: "aguarda_aprov_roteiro" }],
    scripts: [{ id: "script-1", ideaId: "idea-1", title: "Pauta", status: "Aguardando aprovação", version: 1, content: "texto" }],
    videos: [], assets: [], renderJobs: [], audit: [], chat: [], trends: [], adapters: [], connections: [],
    settings: { automation: { publicacao: "Manual" }, demoMode: false },
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

describe("Etapa A · brecha do Portão 1", () => {
  beforeEach(() => { mocked.state = baseState(); mocked.saveStudioState.mockClear(); });

  it("reabre o Portão 1 quando o conteúdo muda depois da aprovação", async () => {
    await executeEditorialCommand({ operation: "approveScript", ideaId: "idea-1" });
    expect(mocked.state.ideas[0].status).toBe("assets");

    const result: any = await executeEditorialCommand({ operation: "updateScript", scriptId: "script-1", content: "conteúdo alterado" });

    expect(result.ideas[0].status).toBe("aguarda_aprov_roteiro");
    expect(result.scripts[0].status).toBe("Aguardando aprovação");
    expect(result.scripts[0].version).toBe(2);
    expect(result.audit[0].action).toBe("Portão 1 reaberto por edição");
    // E o Portão 2 fica inalcançável: o render exige roteiro aprovado.
    await expect(executeEditorialCommand({ operation: "startRender", ideaId: "idea-1" })).rejects.toThrow("Render exige");
  });

  it("não reabre o Portão 1 quando o conteúdo salvo é idêntico", async () => {
    await executeEditorialCommand({ operation: "approveScript", ideaId: "idea-1" });
    const result: any = await executeEditorialCommand({ operation: "updateScript", scriptId: "script-1", content: "texto" });
    expect(result.scripts[0].status).toBe("Aprovado");
    expect(result.ideas[0].status).toBe("assets");
  });
});

describe("Etapa A · render simulado", () => {
  beforeEach(() => {
    mocked.state = baseState();
    mocked.state.ideas[0].status = "assets";
    mocked.state.scripts[0].status = "Aprovado";
    mocked.saveStudioState.mockClear();
  });

  it("marca vídeo e job como simulados e o QA como não verificado", async () => {
    const result: any = await executeEditorialCommand({ operation: "startRender", ideaId: "idea-1" });
    const video = result.videos[0];
    expect(video.simulated).toBe(true);
    expect(video.qa.every((item: any) => item.passed === false && item.verified === false)).toBe(true);
    expect(result.renderJobs[0].status).toBe("simulado");
    expect(result.renderJobs[0].simulated).toBe(true);
    expect(result.audit[0].action).toBe("Render simulado concluído");
  });

  it("bloqueia o Portão 2 e a agenda em vídeo simulado fora do modo demonstração", async () => {
    const rendered: any = await executeEditorialCommand({ operation: "startRender", ideaId: "idea-1" });
    const videoId = rendered.videos[0].id;

    await expect(executeEditorialCommand({ operation: "approveVideo", videoId, overrideQa: true })).rejects.toThrow("simulado");
    await expect(executeEditorialCommand({ operation: "scheduleVideo", videoId })).rejects.toThrow("Portão 2");
  });

  it("permite o fluxo simulado apenas com o modo demonstração ligado", async () => {
    const rendered: any = await executeEditorialCommand({ operation: "startRender", ideaId: "idea-1" });
    const videoId = rendered.videos[0].id;

    const demo: any = await executeEditorialCommand({ operation: "setDemoMode", enabled: true });
    expect(demo.settings.demoMode).toBe(true);

    const approved: any = await executeEditorialCommand({ operation: "approveVideo", videoId, overrideQa: true });
    expect(approved.videos[0].stage).toBe("aprovado_para_agenda");
    expect(approved.audit[0].detail).toContain("SIMULADO");

    const scheduled: any = await executeEditorialCommand({ operation: "scheduleVideo", videoId });
    expect(scheduled.videos[0].stage).toBe("agendado");
  });
});

describe("Etapa A · concorrência otimista", () => {
  it("deixa apenas um de dois comandos simultâneos gravar e avisa o conflito", async () => {
    mocked.state = baseState();
    mocked.saveStudioState.mockClear();

    const results = await Promise.allSettled([
      executeEditorialCommand({ operation: "createIdea", title: "Pauta A", format: "Longo" }),
      executeEditorialCommand({ operation: "createIdea", title: "Pauta B", format: "Short" }),
    ]);

    const fulfilled = results.filter(item => item.status === "fulfilled");
    const rejected = results.filter(item => item.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toContain("Conflito de concorrência");
    // A versão avançou exatamente uma vez: nenhuma gravação foi perdida em silêncio.
    expect(mocked.state.version).toBe(2);
    expect(mocked.state.ideas).toHaveLength(2);
  });

  it("incrementa a versão a cada comando aceito", async () => {
    mocked.state = baseState();
    const first: any = await executeEditorialCommand({ operation: "createIdea", title: "Pauta A", format: "Longo" });
    expect(first.version).toBe(2);
    const second: any = await executeEditorialCommand({ operation: "createIdea", title: "Pauta B", format: "Short" });
    expect(second.version).toBe(3);
  });
});

describe("Etapa A · auditoria e dados de exemplo", () => {
  beforeEach(() => { mocked.state = baseState(); mocked.saveStudioState.mockClear(); });

  it("registra o ator real recebido do contexto", async () => {
    const byOwner: any = await executeEditorialCommand({ operation: "createIdea", title: "Do dono", format: "Longo" }, { actor: "Você" });
    expect(byOwner.audit[0].actor).toBe("Você");

    const byAgent: any = await executeEditorialCommand({ operation: "createIdea", title: "Do Nexo", format: "Longo" }, { actor: "Nexo" });
    expect(byAgent.audit[0].actor).toBe("Nexo");
    expect(mocked.appendStudioAudit).toHaveBeenLastCalledWith(expect.objectContaining({ actor: "Nexo" }));
  });

  it("remove somente itens marcados como exemplo", async () => {
    mocked.state = baseState();
    mocked.state.trends = [{ id: "t1", example: true }, { id: "t2" }];
    mocked.state.ideas = [{ id: "i1", example: true }, { id: "i2" }];
    mocked.state.scripts = [{ id: "s1", example: true }, { id: "s2" }];
    mocked.state.videos = [{ id: "v1", example: true }, { id: "v2" }];
    mocked.state.renderJobs = [{ id: "j1", videoId: "v1" }, { id: "j2", videoId: "v2" }];
    mocked.state.adapters = [{ id: "a1", example: true }, { id: "a2" }];

    const result: any = await executeEditorialCommand({ operation: "clearExampleData" });

    expect(result.trends.map((item: any) => item.id)).toEqual(["t2"]);
    expect(result.ideas.map((item: any) => item.id)).toEqual(["i2"]);
    expect(result.scripts.map((item: any) => item.id)).toEqual(["s2"]);
    expect(result.videos.map((item: any) => item.id)).toEqual(["v2"]);
    expect(result.renderJobs.map((item: any) => item.id)).toEqual(["j2"]);
    expect(result.adapters.map((item: any) => item.id)).toEqual(["a2"]);
  });
});