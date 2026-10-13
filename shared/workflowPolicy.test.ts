import { describe, expect, it } from "vitest";
import { canApproveScript, canApproveVideo, canEditScript, canPublishVideo, canSchedule, canStartRender } from "./workflowPolicy";

describe("política editorial", () => {
  it("bloqueia render antes do Portão 1", () => {
    expect(canStartRender("aguarda_aprov_roteiro", "Aguardando aprovação").allowed).toBe(false);
    expect(canStartRender("assets", "Aprovado").allowed).toBe(true);
  });

  it("bloqueia Portão 2 quando QA ou Portão 1 não foram concluídos", () => {
    expect(canApproveVideo("aguarda_aprov_video", "aguarda_aprov_video", "Aguardando aprovação", true).allowed).toBe(false);
    expect(canApproveVideo("qa", "qa", "Aprovado", true).allowed).toBe(false);
    expect(canApproveVideo("aguarda_aprov_video", "aguarda_aprov_video", "Aprovado", true).allowed).toBe(true);
  });

  it("bloqueia agenda antes do Portão 2", () => {
    expect(canSchedule("aguarda_aprov_video").allowed).toBe(false);
    expect(canSchedule("aprovado_para_agenda").allowed).toBe(true);
  });

  it("aceita apenas um roteiro no estado explícito do Portão 1", () => {
    expect(canApproveScript("roteiro", "Aguardando aprovação").allowed).toBe(false);
    expect(canApproveScript("aguarda_aprov_roteiro", "Aguardando aprovação").allowed).toBe(true);
  });
});

describe("política de render simulado", () => {
  it("bloqueia o Portão 2 de vídeo simulado fora do modo demonstração", () => {
    const blocked = canApproveVideo("aguarda_aprov_video", "aguarda_aprov_video", "Aprovado", true, { simulated: true, demoMode: false });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toContain("simulado");
    expect(canApproveVideo("aguarda_aprov_video", "aguarda_aprov_video", "Aprovado", true, { simulated: true, demoMode: true }).allowed).toBe(true);
    expect(canApproveVideo("aguarda_aprov_video", "aguarda_aprov_video", "Aprovado", true, { simulated: false, demoMode: false }).allowed).toBe(true);
  });

  it("bloqueia a agenda de vídeo simulado fora do modo demonstração", () => {
    expect(canSchedule("aprovado_para_agenda", { simulated: true, demoMode: false }).allowed).toBe(false);
    expect(canSchedule("aprovado_para_agenda", { simulated: true, demoMode: true }).allowed).toBe(true);
    expect(canSchedule("aprovado_para_agenda").allowed).toBe(true);
  });

  it("exige nova aprovação ao editar um roteiro aprovado", () => {
    expect(canEditScript("Aprovado").requiresReapproval).toBe(true);
    expect(canEditScript("Aguardando aprovação").requiresReapproval).toBe(false);
  });
});

describe("regra de publicação", () => {
  const approved = { videoStage: "aprovado_para_agenda", scriptStatus: "Aprovado" } as const;

  it("publica em modo manual apenas com o Portão 2 concluído", () => {
    expect(canPublishVideo({ ...approved, automation: "Manual" }).allowed).toBe(true);
    const blocked = canPublishVideo({ videoStage: "aguarda_aprov_video", scriptStatus: "Aprovado", automation: "Manual" });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toContain("Portão 2");
  });

  it("bloqueia quando o roteiro não está aprovado", () => {
    expect(canPublishVideo({ videoStage: "agendado", scriptStatus: "Aguardando aprovação", automation: "Manual" }).allowed).toBe(false);
  });

  it("exige confirmação explícita para publicação automática", () => {
    const semConfirmacao = canPublishVideo({ ...approved, automation: "Automática", automaticPublicationConfirmed: false });
    expect(semConfirmacao.allowed).toBe(false);
    if (!semConfirmacao.allowed) expect(semConfirmacao.reason).toContain("confirmação explícita");
    expect(canPublishVideo({ ...approved, automation: "Automática", automaticPublicationConfirmed: true }).allowed).toBe(true);
  });

  it("bloqueia vídeo simulado fora do modo demonstração", () => {
    expect(canPublishVideo({ ...approved, simulated: true, demoMode: false, automation: "Manual" }).allowed).toBe(false);
    expect(canPublishVideo({ ...approved, simulated: true, demoMode: true, automation: "Manual" }).allowed).toBe(true);
  });
});
