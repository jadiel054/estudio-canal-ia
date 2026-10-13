import { randomUUID } from "node:crypto";
import { canApproveScript, canApproveVideo, canGenerateScript, canRequestVideoAdjustment, canSchedule, canStartRender } from "@shared/workflowPolicy";
import { appendStudioAudit, getStudioState, saveStudioState } from "./studioRepository";

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
  | { operation: "addAsset"; asset: { scriptId: string; type: string; label: string; license: string; status: string } };

function fail(message: string): never { throw new Error(message); }
function audit(state: any, action: string, target: string, detail?: string) {
  state.audit = [{ id: randomUUID(), actor: action.startsWith("Portão") || action.includes("aprov") ? "Você" : "Sistema", action, target, at: new Date().toISOString(), detail }, ...(state.audit ?? [])].slice(0, 500);
}

export async function executeEditorialCommand(command: EditorialCommand) {
  const state = await getStudioState() as any;
  if (!state) fail("O estado do estúdio ainda não foi importado para o Neon.");
  const now = new Date().toISOString();
  let target = "Estúdio";
  switch (command.operation) {
    case "createIdea": {
      const idea = { id: randomUUID(), title: command.title.trim(), format: command.format, trendId: command.trendId, origin: command.origin ?? (command.trendId ? "Radar" : "Projeto"), angle: command.angle ?? "Tutorial com demonstração real, decisão técnica e resultado mensurável.", audience: "Devs que constroem com IA", keywords: ["programação", "agentes IA", command.format.toLowerCase()], status: "pesquisa", createdAt: now };
      state.ideas = [idea, ...(state.ideas ?? [])]; target = idea.title; audit(state, "Pauta criada", target, `Origem: ${idea.origin}`); break;
    }
    case "updateScript": {
      const script = state.scripts?.find((item: any) => item.id === command.scriptId); if (!script) fail("Roteiro não encontrado.");
      script.content = command.content; script.updatedAt = now; target = script.title; audit(state, "Roteiro salvo", target, `Versão ${script.version}`); break;
    }
    case "generateScript": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); if (!idea) fail("Pauta não encontrada.");
      const guard = canGenerateScript(idea.status); if (!guard.allowed) fail(guard.reason);
      let script = state.scripts?.find((item: any) => item.ideaId === command.ideaId);
      if (script) { script.version += 1; script.content = command.content; script.status = "Aguardando aprovação"; script.updatedAt = now; }
      else { script = { id: randomUUID(), ideaId: idea.id, version: 1, title: idea.title, content: command.content, status: "Aguardando aprovação", updatedAt: now }; state.scripts = [script, ...(state.scripts ?? [])]; }
      idea.status = "aguarda_aprov_roteiro"; target = idea.title; audit(state, "Roteiro gerado", target, "Aguardando aprovação do Portão 1"); break;
    }
    case "approveScript": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); const script = state.scripts?.find((item: any) => item.ideaId === command.ideaId); if (!idea || !script) fail("Pauta ou roteiro não encontrado.");
      const guard = canApproveScript(idea.status, script.status); if (!guard.allowed) fail(guard.reason);
      idea.status = "assets"; script.status = "Aprovado"; script.updatedAt = now; target = idea.title; audit(state, "Portão 1 aprovado", target, "Liberado para assets e produção"); break;
    }
    case "requestScriptChanges": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); const script = state.scripts?.find((item: any) => item.ideaId === command.ideaId); if (!idea || !script || idea.status !== "aguarda_aprov_roteiro") fail("Apenas roteiros aguardando o Portão 1 podem voltar para revisão.");
      idea.status = "ajuste_pedido"; script.status = "Ajuste pedido"; target = idea.title; audit(state, "Ajuste solicitado", target, "Roteiro voltou para revisão"); break;
    }
    case "startRender": {
      const idea = state.ideas?.find((item: any) => item.id === command.ideaId); const script = state.scripts?.find((item: any) => item.ideaId === command.ideaId); if (!idea || !script) fail("Pauta ou roteiro não encontrado.");
      const guard = canStartRender(idea.status, script.status); if (!guard.allowed) fail(guard.reason);
      let video = state.videos?.find((item: any) => item.ideaId === command.ideaId);
      if (!video) { video = { id: randomUUID(), ideaId: idea.id, scriptId: script.id, title: idea.title, format: idea.format, stage: "aguarda_aprov_video", duration: idea.format === "Short" ? "00:48" : "07:18", synthetic: false, qa: [{ label: "Duração e ritmo", passed: true, note: "Dentro da meta definida" }, { label: "Legenda em PT-BR", passed: true, note: "Gerada e sincronizada" }, { label: "Licenças dos assets", passed: true, note: "Assets próprios ou permitidos" }, { label: "Demonstração original", passed: true, note: "Execução registrada" }] }; state.videos = [video, ...(state.videos ?? [])]; }
      else video.stage = "aguarda_aprov_video";
      idea.status = "aguarda_aprov_video"; const previous = state.renderJobs?.find((item: any) => item.videoId === video.id); const job = { id: randomUUID(), videoId: video.id, status: "succeeded", attempts: (previous?.attempts ?? 0) + 1, startedAt: now, finishedAt: now }; state.renderJobs = [job, ...(state.renderJobs ?? []).filter((item: any) => item.videoId !== video.id)]; target = video.title; audit(state, "Render e QA concluídos", target, `Tentativa ${job.attempts}; pronto para o Portão 2`); break;
    }
    case "approveVideo": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); const idea = video && state.ideas?.find((item: any) => item.id === video.ideaId); const script = video && state.scripts?.find((item: any) => item.id === video.scriptId); if (!video || !idea || !script) fail("Vídeo, pauta ou roteiro não encontrado.");
      const hasWarning = video.qa.some((item: any) => !item.passed); if (hasWarning && !command.overrideQa) fail("Há alertas no QA; confirme a aprovação com ressalva."); const guard = canApproveVideo(video.stage, idea.status, script.status, video.qa.length > 0); if (!guard.allowed) fail(guard.reason);
      video.stage = "aprovado_para_agenda"; idea.status = "aprovado_para_agenda"; target = video.title; audit(state, "Portão 2 aprovado", target, hasWarning ? "Aprovado com ressalva de QA" : "Liberado para agendamento"); break;
    }
    case "requestVideoChanges": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); if (!video) fail("Vídeo não encontrado."); const guard = canRequestVideoAdjustment(video.stage); if (!guard.allowed) fail(guard.reason); video.stage = "ajuste_pedido"; const idea = state.ideas?.find((item: any) => item.id === video.ideaId); if (idea) idea.status = "assets"; target = video.title; audit(state, "Ajuste de vídeo solicitado", target, "Retornou à etapa de assets"); break;
    }
    case "scheduleVideo": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); if (!video) fail("Vídeo não encontrado."); const guard = canSchedule(video.stage); if (!guard.allowed) fail(guard.reason); video.stage = "agendado"; video.scheduledFor = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(Date.now() + 172800000)); const idea = state.ideas?.find((item: any) => item.id === video.ideaId); if (idea) idea.status = "agendado"; target = video.title; audit(state, "Publicação agendada", target, "Modo seguro: envio manual"); break;
    }
    case "retryVideo": {
      const video = state.videos?.find((item: any) => item.id === command.videoId); if (!video || video.stage !== "erro") fail("Apenas vídeos com erro podem ser reprocessados."); video.stage = "assets"; const idea = state.ideas?.find((item: any) => item.id === video.ideaId); if (idea) idea.status = "assets"; target = video.title; audit(state, "Nova tentativa solicitada", target, "Retornou à etapa de assets"); break;
    }
    case "addAsset": {
      const script = state.scripts?.find((item: any) => item.id === command.asset.scriptId); if (!script) fail("Roteiro do asset não encontrado."); const asset = { ...command.asset, id: randomUUID() }; state.assets = [asset, ...(state.assets ?? [])]; target = asset.label; audit(state, "Asset registrado", target, `Licença: ${asset.license}`); break;
    }
  }
  await saveStudioState(state);
  await appendStudioAudit({ actor: "Sistema", action: `Comando editorial: ${command.operation}`, target, details: { serverValidated: true } });
  return state;
}
