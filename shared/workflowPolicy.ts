export type EditorialStage =
  | "ideia" | "pesquisa" | "roteiro" | "aguarda_aprov_roteiro" | "assets"
  | "render" | "qa" | "aguarda_aprov_video" | "aprovado_para_agenda"
  | "agendado" | "publicado" | "ajuste_pedido" | "rejeitado" | "erro";

export type GateResult = { allowed: true } | { allowed: false; reason: string };

export function canGenerateScript(stage: EditorialStage): GateResult {
  return ["pesquisa", "roteiro", "ajuste_pedido"].includes(stage)
    ? { allowed: true }
    : { allowed: false, reason: "A pauta precisa estar em pesquisa ou revisão para gerar um roteiro." };
}

export function canApproveScript(stage: EditorialStage, scriptStatus: string): GateResult {
  return stage === "aguarda_aprov_roteiro" && scriptStatus === "Aguardando aprovação"
    ? { allowed: true }
    : { allowed: false, reason: "O Portão 1 só aceita roteiros explicitamente aguardando aprovação." };
}

export function canStartRender(stage: EditorialStage, scriptStatus: string): GateResult {
  return stage === "assets" && scriptStatus === "Aprovado"
    ? { allowed: true }
    : { allowed: false, reason: "Render exige Portão 1 aprovado e assets prontos." };
}

export function canApproveVideo(stage: EditorialStage, ideaStage: EditorialStage, scriptStatus: string, qaFinished: boolean): GateResult {
  return stage === "aguarda_aprov_video" && ideaStage === "aguarda_aprov_video" && scriptStatus === "Aprovado" && qaFinished
    ? { allowed: true }
    : { allowed: false, reason: "O Portão 2 exige render, QA e Portão 1 concluídos." };
}

export function canSchedule(stage: EditorialStage): GateResult {
  return ["aprovado_para_agenda", "agendado"].includes(stage)
    ? { allowed: true }
    : { allowed: false, reason: "Só vídeos aprovados no Portão 2 podem entrar na agenda." };
}

export function canRequestVideoAdjustment(stage: EditorialStage): GateResult {
  return stage === "aguarda_aprov_video"
    ? { allowed: true }
    : { allowed: false, reason: "Ajustes de vídeo são solicitados durante o Portão 2." };
}
