import { describe, expect, it } from "vitest";
import { MAX_STATE_BYTES, parseStudioState, StateTooLargeError } from "./studioStateSchema";

function validState() {
  return {
    version: 3,
    trends: [],
    ideas: [{ id: "i1", origin: "Projeto", title: "Pauta", format: "Longo", angle: "ângulo", audience: "devs", keywords: [], status: "pesquisa", createdAt: "agora" }],
    scripts: [{ id: "s1", ideaId: "i1", version: 1, title: "Roteiro", content: "texto", status: "Rascunho", updatedAt: "agora" }],
    assets: [],
    videos: [],
    renderJobs: [],
    adapters: [],
    connections: [],
    settings: { automation: { radar: "Automática", roteiro: "Manual", producao: "Manual", publicacao: "Manual" }, weeklyGoal: { longos: 2, shorts: 4, lives: 1 }, monthlyCap: 0, voiceMode: "TTS", autonomy: "Revisão total" },
    audit: [],
    chat: [],
  };
}

describe("validação do estado do estúdio", () => {
  it("aceita um estado bem formado", () => {
    const parsed = parseStudioState(validState());
    expect(parsed.ideas).toHaveLength(1);
    expect(parsed.version).toBe(3);
  });

  it("preserva sectionIndex zero-based em capturas e rejeita índices fora do manifesto", () => {
    const state: any = validState();
    state.assets = [{ id: "a1", scriptId: "s1", type: "Tela", label: "Captura", license: "Original", status: "Pronto", sectionIndex: 1 }];
    expect(parseStudioState(state).assets[0].sectionIndex).toBe(1);
    state.assets[0].sectionIndex = 30;
    expect(() => parseStudioState(state)).toThrow(/sectionIndex/);
  });

  it("preserva diagnostics tipados do lint no QA persistido", () => {
    const state: any = validState();
    const diagnostic = { code: "script_unlabeled_paragraph", severity: "error", sectionIndex: 0, section: "Gancho", lineStart: 2, lineEnd: 2, message: "Rotule o parágrafo antes de aprovar.", excerpt: "Texto sem marcador." };
    state.scripts[0].qa = {
      status: "revisar", estimatedDurationMinutes: 0.5, technicalFlags: [], repetitionFlags: [], policyTerms: [],
      originality: { demoRequired: true, demoSpecified: false, evidence: "Não especificado.", genericContentRisk: "alto" },
      summary: "Corrija o lint.", classifier: "heuristic", lintDiagnostics: [diagnostic],
    };
    expect(parseStudioState(state).scripts[0].qa.lintDiagnostics).toEqual([diagnostic]);
  });

  it("rejeita QA com mais diagnostics que o teto seguro do parser", () => {
    const state: any = validState();
    const diagnostic = { code: "script_lint_info", severity: "info", sectionIndex: 0, section: "Gancho", lineStart: 1, lineEnd: 1, message: "Informação." };
    state.scripts[0].qa = {
      status: "revisar", estimatedDurationMinutes: 0.5, technicalFlags: [], repetitionFlags: [], policyTerms: [],
      originality: { demoRequired: true, demoSpecified: false, evidence: "Não especificado.", genericContentRisk: "alto" },
      summary: "Revisar.", classifier: "heuristic", lintDiagnostics: Array.from({ length: 201 }, () => diagnostic),
    };
    expect(() => parseStudioState(state)).toThrow(/lintDiagnostics/);
  });

  it("rejeita estágio editorial desconhecido em vez de gravar qualquer coisa", () => {
    const state = validState();
    state.ideas[0].status = "qualquer_coisa";
    expect(() => parseStudioState(state)).toThrow(/status/);
  });

  it("rejeita formato ausente de configurações", () => {
    const state: any = validState();
    delete state.settings;
    expect(() => parseStudioState(state)).toThrow(/settings/);
  });

  it("rejeita payload acima do limite de tamanho", () => {
    const state: any = validState();
    state.scripts[0].content = "x".repeat(MAX_STATE_BYTES + 1);
    expect(() => parseStudioState(state)).toThrow(StateTooLargeError);
  });

  it("rejeita valores fora de faixa em configurações", () => {
    const state: any = validState();
    state.settings.weeklyGoal.longos = 9999;
    expect(() => parseStudioState(state)).toThrow(/weeklyGoal/);
  });

  it("preserva o diagnóstico seguro associado a um job de render", () => {
    const state: any = validState();
    state.renderJobs = [{
      id: "job-1", videoId: "video-1", status: "failed", attempts: 1,
      error: "operation=voice code=tts_timeout http=400 upstream=429",
      errorCode: "tts_quota_daily", errorOperation: "voice", httpStatus: 400, upstreamStatus: 429,
      quotaScope: "rpd", quotaValue: 25, quotaMetric: "generativelanguage.googleapis.com/requests_per_day", quotaId: "tts_requests", retryAfterMs: 86_400_000, providerModel: "gemini-3.8-flash-tts",
    }];
    expect(parseStudioState(state).renderJobs[0]).toMatchObject({
      errorCode: "tts_quota_daily", errorOperation: "voice", httpStatus: 400, upstreamStatus: 429,
      quotaScope: "rpd", quotaValue: 25, quotaMetric: "generativelanguage.googleapis.com/requests_per_day", quotaId: "tts_requests", retryAfterMs: 86_400_000, providerModel: "gemini-3.8-flash-tts",
    });
  });

  it("rejeita entrada que não é objeto", () => {
    expect(() => parseStudioState("estado solto")).toThrow();
  });
});
