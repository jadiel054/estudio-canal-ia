export type EditorialStage =
  | "ideia" | "pesquisa" | "roteiro" | "aguarda_aprov_roteiro" | "assets"
  | "render" | "qa" | "aguarda_aprov_video" | "aprovado_para_agenda"
  | "agendado" | "publicado" | "ajuste_pedido" | "rejeitado" | "erro";

export type GateResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Contexto de vídeo simulado.
 *
 * Um vídeo explicitamente simulado nunca pode atravessar o Portão 2 nem entrar
 * na agenda fora de um modo "demonstração" explícito, ligado pelo dono nas
 * Configurações. O pipeline real usa `simulated: false` e QA de arquivo.
 */
export type SimulationContext = { simulated?: boolean; demoMode?: boolean };

function simulationGate(options: SimulationContext | undefined, gate: string): GateResult {
  if (options?.simulated && !options?.demoMode) {
    return { allowed: false, reason: `Vídeo simulado: o ${gate} está bloqueado. Ative o modo demonstração nas Configurações para validar o fluxo, ou produza um vídeo real.` };
  }
  return { allowed: true };
}

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

/**
 * Editar um roteiro já aprovado invalida o Portão 1: o roteiro volta para
 * "Aguardando aprovação" e a pauta retorna a `aguarda_aprov_roteiro`, para que
 * nenhuma mudança de conteúdo passe sem nova aprovação humana.
 */
export function canEditScript(scriptStatus: string): { requiresReapproval: boolean; reason: string } {
  return scriptStatus === "Aprovado"
    ? { requiresReapproval: true, reason: "O roteiro já estava aprovado: a edição reabre o Portão 1 e exige nova aprovação." }
    : { requiresReapproval: false, reason: "Edição livre: o roteiro ainda não foi aprovado." };
}

export function canStartRender(stage: EditorialStage, scriptStatus: string): GateResult {
  return stage === "assets" && scriptStatus === "Aprovado"
    ? { allowed: true }
    : { allowed: false, reason: "Render exige Portão 1 aprovado e assets prontos." };
}

export function canApproveVideo(stage: EditorialStage, ideaStage: EditorialStage, scriptStatus: string, qaFinished: boolean, options?: SimulationContext): GateResult {
  if (!(stage === "aguarda_aprov_video" && ideaStage === "aguarda_aprov_video" && scriptStatus === "Aprovado" && qaFinished)) {
    return { allowed: false, reason: "O Portão 2 exige render, QA e Portão 1 concluídos." };
  }
  return simulationGate(options, "Portão 2");
}

export function canSchedule(stage: EditorialStage, options?: SimulationContext): GateResult {
  if (!["aprovado_para_agenda", "agendado"].includes(stage)) {
    return { allowed: false, reason: "Só vídeos aprovados no Portão 2 podem entrar na agenda." };
  }
  return simulationGate(options, "agendamento");
}

/**
 * Regra única de publicação, verificada no servidor lendo o Neon:
 *
 * 1. O vídeo precisa estar aprovado no Portão 2 (`aprovado_para_agenda` ou
 *    `agendado`) e o roteiro precisa continuar aprovado.
 * 2. Vídeo simulado só passa em modo demonstração explícito.
 * 3. Com a etapa `publicacao` em "Automática", o envio automático exige uma
 *    confirmação explícita do dono registrada no Neon. Em "Manual" o estúdio
 *    apenas libera o pacote/exportação — o envio é feito pelo dono.
 */
export function canPublishVideo(input: {
  videoStage: EditorialStage;
  scriptStatus: string;
  simulated?: boolean;
  demoMode?: boolean;
  automation?: "Automática" | "Manual";
  automaticPublicationConfirmed?: boolean;
}): GateResult {
  if (!["aprovado_para_agenda", "agendado"].includes(input.videoStage)) {
    return { allowed: false, reason: "Publicação bloqueada: o vídeo precisa estar aprovado no Portão 2." };
  }
  if (input.scriptStatus !== "Aprovado") {
    return { allowed: false, reason: "Publicação bloqueada: o roteiro não está aprovado no Portão 1." };
  }
  const simulation = simulationGate({ simulated: input.simulated, demoMode: input.demoMode }, "publicação");
  if (!simulation.allowed) return simulation;
  if (input.automation === "Automática" && !input.automaticPublicationConfirmed) {
    return { allowed: false, reason: "Publicação automática exige sua confirmação explícita registrada no servidor. Sem isso, o estúdio libera apenas a publicação manual." };
  }
  return { allowed: true };
}

export function canRequestVideoAdjustment(stage: EditorialStage): GateResult {
  return stage === "aguarda_aprov_video"
    ? { allowed: true }
    : { allowed: false, reason: "Ajustes de vídeo são solicitados durante o Portão 2." };
}

export function canRejectVideo(stage: EditorialStage): GateResult {
  return stage === "aguarda_aprov_video"
    ? { allowed: true }
    : { allowed: false, reason: "Só é possível rejeitar um vídeo durante o Portão 2." };
}
