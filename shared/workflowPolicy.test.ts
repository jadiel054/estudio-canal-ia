import { describe, expect, it } from "vitest";
import { canApproveScript, canApproveVideo, canSchedule, canStartRender } from "./workflowPolicy";

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
