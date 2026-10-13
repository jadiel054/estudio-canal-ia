import { randomUUID } from "node:crypto";
import { canApproveScript, canApproveVideo, canEditScript, canGenerateScript, canRequestVideoAdjustment, canSchedule, canStartRender } from "@shared/workflowPolicy";
import { appendStudioAudit, getStudioState, saveStudioState, stateVersion } from "./studioRepository";

export type EditorialActor = "Você" | "Nexo" | "Sistema";

export type EditorialCommand =
  | { operation: "createIdea"; title: string; format: "Longo" | "Short" | "Live"; origin?: "Radar" | "Projeto" | "Agente"; trendId?: string; angle?: string }
  | { operation: "updateScript"; scriptId: string; content: string }
  | { operation: "generateScript"; ideaId: string; content: string }
  | { operation: "approveScript"; ideaId: string }
  | { operation: "requestScriptChanges"; ideaId: string }
  | { operation: "startRender"; ideaId: string }
  | { operation: "approveVideo"; videoId: string; overrideQa: boolean }
  | { operation: "requestVideoChanges"; videoId: string }
  | { operation: "scheduleVideo"; videoId: string }
  | { operation: "retryVideo"; videoId: string }
  | { operation: "setDemoMode"; enabled: boolean }
  | { operation: "clearExampleData" }
  | { operation: "addAsset"; asset: { scriptId: string; type: string; label: string; license: string; status: string } };

function fail(message: string): never { throw new Error(message); }

/** Registra a ação com o ator real recebido do contexto (dono, Nexo ou sistema). */
function audit(state: any, actor: EditorialActor, action: string, target: string, detail?: string) {
  state.audit = [{ id: randomUUID(), actor, action, target, at: new Date().toISOString(), detail }, ...(state.audit ?? [])].slice(0, 500);
}

function isDemoMode(state: any) { return state?.settings?.demoMode === true; }

export async function executeEditorialCommand(command: EditorialCommand, context: { actor: EditorialActor } = { actor: "Você" }) {
  const actor = context.actor;
  const state = await getStudioState() as any;
  if (!state) fail("O estado do estúdio ainda não foi importado para o Neon.");
  // Versão lida agora: a gravação só passa se ninguém salvou o estado no meio do caminho.
  const expectedVersion = stateVersion(state);
  const now = new Date().toISOString();
  let target = "Estúdio";
  switch (command.operation) {
    case "createIdea": {
      const idea = { id: randomUUID(), title: command.title.trim(), format: command.format, trendId: command.trendId, origin: command.origin ?? (command.trendId ? "Radar" : "Projeto"), angle: command.angle ?? "Tutorial com demonstração real, decisão técnica e resultado mensurável.", audience: "Devs que constroem com IA", keywords: ["programação", "agentes IA", command.format.toLowerCase()], status: "pesquisa", createdAt: now };
      state.ideas = [idea, ...(state.ideas ?? [])]; target = idea.title; audit(state, actor, "Pauta criada", target, `Origem: ${idea.origin}`); break;
    }
    case "updateScript": {
      const script = state.scripts?.find((item: any) => item.id === command.scriptId); if (!script) fail("Roteiro não encontrado.");
      const idea = state.ideas?.find((item: any) => item.id === script.ideaId);
      const unchanged = script.content === command.content;
      const guard = canEditScript(script.status);
      script.content = command.content; script.updatedAt = now;
      if (guard.requiresReapproval && !unchanged) {
        // Brecha do Portão 1 fechada: editar um roteiro aprovado invalida a aprovação.
        script.version += 1; script.status = "Aguardando aprovação";
        if (idea) idea.status = "aguarda_aprov_roteiro";
        target = script.title;
        audit(state, actor, "Portão 1 reaberto por edição", target, `Versão ${script.version}. O conteúdo mudou depois da aprovação e exige nova decisão humana.`);
        break;
      }
      target = script.title; audit(state, actor, "Roteiro salvo", target, `Versão ${script.version}${unchanged ? " (sem alteração de conteúdo)" : ""}`); break;
    }
    case "generateScript": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); if (!idea) fail("Pauta não encontrada.");
      const guard = canGenerateScript(idea.status); if (!guard.allowed) fail(guard.reason);
      let script = state.scripts?.find((item: any) => item.ideaId === command.ideaId);
      if (script) { script.version += 1; script.content = command.content; script.status = "Aguardando aprovação"; script.updatedAt = now; }
      else { script = { id: randomUUID(), ideaId: idea.id, version: 1, title: idea.title, content: command.content, status: "Aguardando aprovação", updatedAt: now }; state.scripts = [script, ...(state.scripts ?? [])]; }
      idea.status = "aguarda_aprov_roteiro"; target = idea.title; audit(state, actor, "Roteiro gerado", target, "Aguardando aprovação do Portão 1"); break;
    }
    case "approveScript": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); const script = state.scripts?.find((item: any) => item.ideaId === command.ideaId); if (!idea || !script) fail("Pauta ou roteiro não encontrado.");
      const guard = canApproveScript(idea.status, script.status); if (!guard.allowed) fail(guard.reason);
      idea.status = "assets"; script.status = "Aprovado"; script.updatedAt = now; target = idea.title; audit(state, actor, "Portão 1 aprovado", target, "Liberado para assets e produção"); break;
    }
    case "requestScriptChanges": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); const script = state.scripts?.find((item: any) => item.ideaId === command.ideaId); if (!idea || !script || idea.status !== "aguarda_aprov_roteiro") fail("Apenas roteiros aguardando o Portão 1 podem voltar para revisão.");
      idea.status = "ajuste_pedido"; script.status = "Ajuste pedido"; target = idea.title; audit(state, actor, "Ajuste solicitado", target, "Roteiro voltou para revisão"); break;
    }
    case "startRender": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); const script = state.scripts?.find((item: any) => item.ideaId === command.ideaId); if (!idea || !script) fail("Pauta ou roteiro não encontrado.");
      const guard = canStartRender(idea.status, script.status); if (!guard.allowed) fail(guard.reason);
      // RENDER SIMULADO: não existe FFmpeg nem arquivo final neste corte.
      // Vídeo e job ficam marcados como `simulado` e o QA é registrado como NÃO
      // VERIFICADO — nada aqui é apresentado como aprovado de verdade.
      const simulatedQa = [
        { label: "Duração e ritmo", passed: false, verified: false, note: "Não verificado — render simulado" },
        { label: "Legenda em PT-BR", passed: false, verified: false, note: "Não verificado — render simulado" },
        { label: "Licenças dos assets", passed: false, verified: false, note: "Não verificado — render simulado" },
        { label: "Demonstração original", passed: false, verified: false, note: "Não verificado — render simulado" },
      ];
      let video = state.videos?.find((item: any) => item.ideaId === command.ideaId);
      if (!video) {
        video = { id: randomUUID(), ideaId: idea.id, scriptId: script.id, title: idea.title, format: idea.format, stage: "aguarda_aprov_video", duration: idea.format === "Short" ? "00:48 (estimado)" : "07:18 (estimado)", synthetic: true, simulated: true, qa: simulatedQa };
        state.videos = [video, ...(state.videos ?? [])];
      } else {
        video.stage = "aguarda_aprov_video"; video.simulated = true; video.synthetic = true; video.duration = `${video.duration.replace(/ \(estimado\)$/, "")} (estimado)`; video.qa = simulatedQa;
      }
      idea.status = "aguarda_aprov_video";
      const previous = state.renderJobs?.find((item: any) => item.videoId === video.id);
      const job = { id: randomUUID(), videoId: video.id, status: "simulado", simulated: true, attempts: (previous?.attempts ?? 0) + 1, startedAt: now, finishedAt: now };
      state.renderJobs = [job, ...(state.renderJobs ?? []).filter((item: any) => item.videoId !== video.id)];
      target = video.title;
      audit(state, actor, "Render simulado concluído", target, `Tentativa ${job.attempts}. Nenhum arquivo de vídeo foi produzido e o QA está não verificado; o Portão 2 exige modo demonstração.`);
      break;
    }
    case "approveVideo": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); const idea = video && state.ideas?.find((item: any) => item.id === video.ideaId); const script = video && state.scripts?.find((item: any) => item.id === video.scriptId); if (!video || !idea || !script) fail("Vídeo, pauta ou roteiro não encontrado.");
      const simulation = { simulated: Boolean(video.simulated), demoMode: isDemoMode(state) };
      const hasWarning = video.qa.some((item: any) => !item.passed); if (hasWarning && !command.overrideQa) fail("Há alertas no QA; confirme a aprovação com ressalva."); const guard = canApproveVideo(video.stage, idea.status, script.status, video.qa.length > 0, simulation); if (!guard.allowed) fail(guard.reason);
      video.stage = "aprovado_para_agenda"; idea.status = "aprovado_para_agenda"; target = video.title;
      audit(state, actor, "Portão 2 aprovado", target, simulation.simulated ? "Vídeo SIMULADO aprovado em modo demonstração — sem arquivo real" : hasWarning ? "Aprovado com ressalva de QA" : "Liberado para agendamento");
      break;
    }
    case "requestVideoChanges": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); if (!video) fail("Vídeo não encontrado."); const guard = canRequestVideoAdjustment(video.stage); if (!guard.allowed) fail(guard.reason); video.stage = "ajuste_pedido"; const idea = state.ideas?.find((item: any) => item.id === video.ideaId); if (idea) idea.status = "assets"; target = video.title; audit(state, actor, "Ajuste de vídeo solicitado", target, "Retornou à etapa de assets"); break;
    }
    case "scheduleVideo": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); if (!video) fail("Vídeo não encontrado."); const guard = canSchedule(video.stage, { simulated: Boolean(video.simulated), demoMode: isDemoMode(state) }); if (!guard.allowed) fail(guard.reason); video.stage = "agendado"; video.scheduledFor = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(Date.now() + 172800000)); const idea = state.ideas?.find((item: any) => item.id === video.ideaId); if (idea) idea.status = "agendado"; target = video.title; audit(state, actor, "Publicação agendada", target, video.simulated ? "Slot reservado em modo demonstração (vídeo simulado)" : "Modo seguro: envio manual"); break;
    }
    case "retryVideo": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); if (!video || video.stage !== "erro") fail("Apenas vídeos com erro podem ser reprocessados."); video.stage = "assets"; const idea = state.ideas?.find((item: any) => item.id === video.ideaId); if (idea) idea.status = "assets"; target = video.title; audit(state, actor, "Nova tentativa solicitada", target, "Retornou à etapa de assets"); break;
    }
    case "setDemoMode": {
      state.settings = { ...state.settings, demoMode: command.enabled };
      target = "Modo demonstração";
      audit(state, actor, command.enabled ? "Modo demonstração ativado" : "Modo demonstração desativado", target, command.enabled ? "Vídeos simulados podem passar pelo Portão 2 e pela agenda para validar o fluxo" : "Somente vídeos com render real podem avançar");
      break;
    }
    case "clearExampleData": {
      const removed = {
        trends: (state.trends ?? []).filter((item: any) => item.example).length,
        ideas: (state.ideas ?? []).filter((item: any) => item.example).length,
        scripts: (state.scripts ?? []).filter((item: any) => item.example).length,
        videos: (state.videos ?? []).filter((item: any) => item.example).length,
      };
      const exampleVideoIds = new Set((state.videos ?? []).filter((item: any) => item.example).map((item: any) => item.id));
      state.trends = (state.trends ?? []).filter((item: any) => !item.example);
      state.ideas = (state.ideas ?? []).filter((item: any) => !item.example);
      state.scripts = (state.scripts ?? []).filter((item: any) => !item.example);
      state.videos = (state.videos ?? []).filter((item: any) => !item.example);
      state.assets = (state.assets ?? []).filter((item: any) => !item.example);
      state.renderJobs = (state.renderJobs ?? []).filter((item: any) => !item.example && !exampleVideoIds.has(item.videoId));
      state.adapters = (state.adapters ?? []).filter((item: any) => !item.example);
      state.audit = (state.audit ?? []).filter((item: any) => !item.example);
      state.chat = (state.chat ?? []).filter((item: any) => !item.example);
      target = "Dados de exemplo";
      audit(state, actor, "Dados de exemplo removidos", target, `Removidos: ${removed.trends} sinais, ${removed.ideas} pautas, ${removed.scripts} roteiros, ${removed.videos} vídeos. Nenhum dado real foi afetado.`);
      break;
    }
    case "addAsset": {
      const script = state.scripts?.find((item: any) => item.id === command.asset.scriptId); if (!script) fail("Roteiro do asset não encontrado."); const asset = { ...command.asset, id: randomUUID() }; state.assets = [asset, ...(state.assets ?? [])]; target = asset.label; audit(state, actor, "Asset registrado", target, `Licença: ${asset.license}`); break;
    }
  }
  const saved = await saveStudioState(state, { expectedVersion });
  await appendStudioAudit({ actor, action: `Comando editorial: ${command.operation}`, target, details: { serverValidated: true, actor, version: stateVersion(saved) } });
  return saved;
}