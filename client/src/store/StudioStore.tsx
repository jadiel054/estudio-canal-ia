import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { canApproveScript, canApproveVideo, canGenerateScript, canRequestVideoAdjustment, canSchedule, canStartRender } from "@shared/workflowPolicy";
import {
  type Adapter,
  type AgentAction,
  type Asset,
  type AuditEntry,
  type ChatMessage,
  type Connection,
  type Format,
  type Idea,
  type Platform,
  type RenderJob,
  type Script,
  type StudioSettings,
  type Trend,
  type Video,
  type VideoStage,
  seedState,
} from "@/data/studio";

export type StudioState = {
  trends: Trend[];
  ideas: Idea[];
  scripts: Script[];
  assets: Asset[];
  videos: Video[];
  renderJobs: RenderJob[];
  adapters: Adapter[];
  connections: Connection[];
  settings: StudioSettings;
  audit: AuditEntry[];
  chat: ChatMessage[];
};

type StudioActions = {
  createIdea: (params: Pick<Idea, "title" | "format"> & Partial<Pick<Idea, "trendId" | "origin" | "angle">>) => Idea;
  updateScript: (id: string, content: string) => void;
  generateScript: (ideaId: string, generatedContent?: string) => void;
  approveScript: (ideaId: string) => void;
  requestScriptChanges: (ideaId: string) => void;
  startRender: (ideaId: string) => void;
  approveVideo: (videoId: string, options?: { overrideQa?: boolean }) => void;
  requestVideoChanges: (videoId: string) => void;
  scheduleVideo: (videoId: string) => void;
  retryVideo: (videoId: string) => void;
  addAsset: (asset: Omit<Asset, "id">) => void;
  updateSettings: (patch: Partial<StudioSettings>, actor?: AuditEntry["actor"]) => void;
  setAutomation: (key: keyof StudioSettings["automation"], value: "Automática" | "Manual", actor?: AuditEntry["actor"]) => void;
  selectAdapter: (id: string, actor?: AuditEntry["actor"]) => void;
  requestPlatformConnection: (platform: Platform, actor?: AuditEntry["actor"]) => void;
  addChat: (message: ChatMessage) => void;
  applyAgentActions: (actions: AgentAction[]) => void;
  addAudit: (entry: Omit<AuditEntry, "id" | "at">) => void;
  resetDemo: () => void;
  importDeviceData: () => void;
};

type StudioContextValue = StudioState & StudioActions;
const StudioContext = createContext<StudioContextValue | null>(null);
const storageKey = "estudio-canal-ia-v1";

function cloneSeed(): StudioState {
  return JSON.parse(JSON.stringify(seedState)) as StudioState;
}

function initialState(): StudioState {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved) as StudioState;
  } catch {
    // Dados de demonstração continuam disponíveis se o armazenamento falhar.
  }
  return cloneSeed();
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StudioState>(initialState);
  const deviceSnapshot = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [serverBacked, setServerBacked] = useState(false);
  const stateQuery = trpc.studio.state.useQuery(undefined, { retry: 1, refetchOnWindowFocus: false });
  const saveState = trpc.studio.saveState.useMutation();
  const importState = trpc.studio.importState.useMutation({ onSuccess: () => { setState(deviceSnapshot.current); setServerBacked(true); toast.success("Dados deste aparelho importados para o Neon"); }, onError: error => toast.error("Importação indisponível", { description: `${error.message} Tente de novo.` }) });

  useEffect(() => {
    if (!stateQuery.isSuccess || hydrated) return;
    if (stateQuery.data) { setState(stateQuery.data as StudioState); setServerBacked(true); }
    setHydrated(true);
  }, [stateQuery.isSuccess, stateQuery.data, hydrated]);

  useEffect(() => {
    if (!hydrated || !serverBacked) return;
    const timer = window.setTimeout(() => saveState.mutate(state), 350);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, serverBacked]);

  const addAudit = (entry: Omit<AuditEntry, "id" | "at">) => {
    setState(current => ({
      ...current,
      audit: [
        { id: crypto.randomUUID(), at: "agora", ...entry },
        ...current.audit,
      ].slice(0, 80),
    }));
  };

  const createIdea: StudioActions["createIdea"] = params => {
    const idea: Idea = {
      id: crypto.randomUUID(),
      title: params.title,
      format: params.format,
      trendId: params.trendId,
      origin: params.origin ?? (params.trendId ? "Radar" : "Projeto"),
      angle: params.angle ?? "Tutorial com demonstração real, decisão técnica e resultado mensurável.",
      audience: "Devs que constroem com IA",
      keywords: ["programação", "agentes IA", params.format.toLowerCase()],
      status: "pesquisa",
      createdAt: "agora",
    };
    setState(current => ({
      ...current,
      ideas: [idea, ...current.ideas],
      audit: [
        { id: crypto.randomUUID(), actor: "Você", action: "Pauta criada", target: idea.title, at: "agora", detail: `Origem: ${idea.origin}` },
        ...current.audit,
      ],
    }));
    toast.success("Pauta criada", { description: "Ela entrou na etapa de pesquisa." });
    return idea;
  };

  const updateScript: StudioActions["updateScript"] = (id, content) => {
    setState(current => {
      const script = current.scripts.find(item => item.id === id);
      if (!script) return current;
      const entry: AuditEntry = { id: crypto.randomUUID(), actor: "Você", action: "Roteiro salvo", target: script.title, at: new Date().toISOString(), detail: `Versão ${script.version}` };
      return {
        ...current,
        scripts: current.scripts.map(item => item.id === id ? { ...item, content, updatedAt: "agora" } : item),
        audit: [entry, ...current.audit].slice(0, 500),
      };
    });
  };

  const generateScript: StudioActions["generateScript"] = (ideaId, generatedContent) => {
    const currentIdea = state.ideas.find(item => item.id === ideaId);
    if (!currentIdea) {
      toast.error("Pauta não encontrada");
      return;
    }
    const guard = canGenerateScript(currentIdea.status);
    if (!guard.allowed) {
      toast.error("Geração de roteiro bloqueada", { description: guard.reason });
      return;
    }
    setState(current => {
      const idea = current.ideas.find(item => item.id === ideaId);
      if (!idea) return current;
      const existing = current.scripts.find(script => script.ideaId === ideaId);
      const generated: Script = existing ?? {
        id: crypto.randomUUID(),
        ideaId,
        version: 1,
        title: idea.title,
        content: generatedContent ?? `# Gancho — 0:00\nMostre em 10 segundos o resultado real de: ${idea.title}.\n\n# Problema — 0:18\nExplique o custo de fazer isso sem uma stack clara.\n\n# Demonstração real — 0:55\nAbra o projeto, rode o código, mostre uma decisão técnica e um erro que foi corrigido.\n\n# Resultado — 5:40\nCompare antes/depois e mostre o artefato final.\n\n# CTA — 6:30\nConvide para o próximo passo prático, sem promessa genérica.`,
        status: "Aguardando aprovação",
        updatedAt: "agora",
      };
      return {
        ...current,
        ideas: current.ideas.map(item => item.id === ideaId ? { ...item, status: "aguarda_aprov_roteiro" } : item),
        scripts: existing ? current.scripts.map(script => script.id === existing.id ? { ...script, version: script.version + 1, status: "Aguardando aprovação", updatedAt: "agora" } : script) : [generated, ...current.scripts],
        audit: [{ id: crypto.randomUUID(), actor: "Nexo", action: "Roteiro gerado", target: idea.title, at: "agora", detail: "Template tutorial com demonstração real" }, ...current.audit],
      };
    });
    toast.success("Roteiro pronto para sua aprovação");
  };

  const approveScript: StudioActions["approveScript"] = ideaId => {
    const currentIdea = state.ideas.find(item => item.id === ideaId);
    const currentScript = state.scripts.find(item => item.ideaId === ideaId);
    const guard = currentIdea && currentScript ? canApproveScript(currentIdea.status, currentScript.status) : { allowed: false as const, reason: "Roteiro não encontrado." };
    if (!guard.allowed) {
      toast.error("Este roteiro não está elegível para aprovação", { description: guard.reason });
      return;
    }
    setState(current => {
      const idea = current.ideas.find(item => item.id === ideaId);
      if (!idea) return current;
      return {
        ...current,
        ideas: current.ideas.map(item => item.id === ideaId ? { ...item, status: "assets" } : item),
        scripts: current.scripts.map(script => script.ideaId === ideaId ? { ...script, status: "Aprovado", updatedAt: "agora" } : script),
        audit: [{ id: crypto.randomUUID(), actor: "Você", action: "Portão 1 aprovado", target: idea.title, at: "agora", detail: "Liberado para assets e produção" }, ...current.audit],
      };
    });
    toast.success("Roteiro aprovado", { description: "A produção pode começar." });
  };

  const requestScriptChanges: StudioActions["requestScriptChanges"] = ideaId => {
    const currentIdea = state.ideas.find(item => item.id === ideaId);
    if (!currentIdea || currentIdea.status !== "aguarda_aprov_roteiro") {
      toast.error("Ajuste indisponível", { description: "Apenas roteiros aguardando o Portão 1 podem voltar para revisão." });
      return;
    }
    setState(current => ({
      ...current,
      ideas: current.ideas.map(item => item.id === ideaId ? { ...item, status: "ajuste_pedido" } : item),
      scripts: current.scripts.map(script => script.ideaId === ideaId ? { ...script, status: "Ajuste pedido" } : script),
      audit: [{ id: crypto.randomUUID(), actor: "Você", action: "Ajuste solicitado", target: current.ideas.find(item => item.id === ideaId)?.title ?? "Roteiro", at: "agora", detail: "Voltou para revisão" }, ...current.audit],
    }));
    toast.message("Roteiro devolvido para ajuste");
  };

  const startRender: StudioActions["startRender"] = ideaId => {
    const idea = state.ideas.find(item => item.id === ideaId);
    const script = state.scripts.find(item => item.ideaId === ideaId);
    if (!idea || !script) {
      toast.error("Render bloqueado", { description: "Pauta ou roteiro não encontrado." });
      return;
    }
    const guard = canStartRender(idea.status, script.status);
    if (!guard.allowed) {
      toast.error("Render bloqueado", { description: guard.reason });
      return;
    }

    let videoId = "";
    setState(current => {
      const existing = current.videos.find(video => video.ideaId === ideaId);
      const video: Video = existing ?? {
        id: crypto.randomUUID(), ideaId, scriptId: script.id, title: idea.title, format: idea.format,
        stage: "render", duration: idea.format === "Short" ? "00:48" : "07:18", synthetic: false,
        qa: [
          { label: "Duração e ritmo", passed: true, note: "Dentro da meta definida" },
          { label: "Legenda em PT-BR", passed: true, note: "Gerada e sincronizada" },
          { label: "Licenças dos assets", passed: true, note: "Assets próprios ou permitidos" },
          { label: "Demonstração original", passed: true, note: "Execução registrada" },
        ],
      };
      videoId = video.id;
      const job: RenderJob = { id: crypto.randomUUID(), videoId: video.id, status: "rendering", attempts: (current.renderJobs.find(item => item.videoId === video.id)?.attempts ?? 0) + 1, startedAt: new Date().toISOString() };
      return {
        ...current,
        ideas: current.ideas.map(item => item.id === ideaId ? { ...item, status: "render" } : item),
        videos: existing ? current.videos.map(item => item.id === existing.id ? { ...item, stage: "render" } : item) : [{ ...video, stage: "render" }, ...current.videos],
        renderJobs: [job, ...current.renderJobs.filter(item => item.videoId !== video.id)],
        audit: ([{ id: crypto.randomUUID(), actor: "Sistema", action: "Job de render iniciado", target: idea.title, at: new Date().toISOString(), detail: `Tentativa ${job.attempts}` }, ...current.audit] as AuditEntry[]).slice(0, 500),
      };
    });
    toast.message("Render iniciado", { description: "A fila passou por render e seguirá para QA." });

    window.setTimeout(() => {
      setState(current => ({
        ...current,
        videos: current.videos.map(video => video.id === videoId ? { ...video, stage: "qa" } : video),
        ideas: current.ideas.map(item => item.id === ideaId ? { ...item, status: "qa" } : item),
        renderJobs: current.renderJobs.map(job => job.videoId === videoId ? { ...job, status: "qa" } : job),
        audit: ([{ id: crypto.randomUUID(), actor: "Sistema", action: "QA iniciado", target: idea.title, at: new Date().toISOString(), detail: "Checklist automático em execução" }, ...current.audit] as AuditEntry[]).slice(0, 500),
      }));
    }, 550);
    window.setTimeout(() => {
      setState(current => ({
        ...current,
        videos: current.videos.map(video => video.id === videoId ? { ...video, stage: "aguarda_aprov_video" } : video),
        ideas: current.ideas.map(item => item.id === ideaId ? { ...item, status: "aguarda_aprov_video" } : item),
        renderJobs: current.renderJobs.map(job => job.videoId === videoId ? { ...job, status: "succeeded", finishedAt: new Date().toISOString() } : job),
        audit: ([{ id: crypto.randomUUID(), actor: "Sistema", action: "Render e QA concluídos", target: idea.title, at: new Date().toISOString(), detail: "Pronto para o Portão 2" }, ...current.audit] as AuditEntry[]).slice(0, 500),
      }));
      toast.success("Prévia pronta", { description: "O Portão 2 agora está disponível." });
    }, 1150);
  };

  const approveVideo: StudioActions["approveVideo"] = (videoId, options = {}) => {
    const video = state.videos.find(item => item.id === videoId);
    const idea = video ? state.ideas.find(item => item.id === video.ideaId) : undefined;
    const script = video ? state.scripts.find(item => item.id === video.scriptId) : undefined;
    if (!video || !idea || !script) {
      toast.error("Aprovação final bloqueada", { description: "Vídeo, pauta ou roteiro não encontrado." });
      return;
    }
    const hasQaWarning = video.qa.some(item => !item.passed);
    const guard = canApproveVideo(video.stage, idea.status, script.status, video.qa.length > 0);
    if (!guard.allowed) {
      toast.error("Aprovação final bloqueada", { description: guard.reason });
      return;
    }
    if (hasQaWarning && !options.overrideQa) {
      toast.warning("Há alertas no QA", { description: "Confirme explicitamente a aprovação com ressalva." });
      return;
    }
    setState(current => ({
      ...current,
      videos: current.videos.map(item => item.id === videoId ? { ...item, stage: "aprovado_para_agenda" } : item),
      ideas: current.ideas.map(item => item.id === video.ideaId ? { ...item, status: "aprovado_para_agenda" } : item),
      audit: ([{ id: crypto.randomUUID(), actor: "Você", action: "Portão 2 aprovado", target: video.title, at: new Date().toISOString(), detail: hasQaWarning ? "Aprovado com ressalva de QA" : "Liberado para agendamento" }, ...current.audit] as AuditEntry[]).slice(0, 500),
    }));
    toast.success("Vídeo aprovado", { description: "Ele está liberado para você reservar um horário." });
  };

  const requestVideoChanges: StudioActions["requestVideoChanges"] = videoId => {
    const video = state.videos.find(item => item.id === videoId);
    if (!video) {
      toast.error("Ajuste indisponível", { description: "Vídeo não encontrado." });
      return;
    }
    const guard = canRequestVideoAdjustment(video.stage);
    if (!guard.allowed) {
      toast.error("Ajuste indisponível", { description: guard.reason });
      return;
    }
    setState(current => ({
      ...current,
      videos: current.videos.map(item => item.id === videoId ? { ...item, stage: "ajuste_pedido" } : item),
      ideas: current.ideas.map(item => item.id === video.ideaId ? { ...item, status: "assets" } : item),
      audit: ([{ id: crypto.randomUUID(), actor: "Você", action: "Ajuste solicitado", target: video.title, at: new Date().toISOString(), detail: "Retornou à etapa de assets" }, ...current.audit] as AuditEntry[]).slice(0, 500),
    }));
    toast.message("Vídeo devolvido para ajuste");
  };

  const scheduleVideo: StudioActions["scheduleVideo"] = videoId => {
    const video = state.videos.find(item => item.id === videoId);
    if (!video) {
      toast.error("Agendamento bloqueado", { description: "Vídeo não encontrado." });
      return;
    }
    const guard = canSchedule(video.stage);
    if (!guard.allowed) {
      toast.error("Agendamento bloqueado", { description: guard.reason });
      return;
    }
    const schedule = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + 1000 * 60 * 60 * 24 * 2));
    setState(current => ({
      ...current,
      videos: current.videos.map(item => item.id === videoId ? { ...item, stage: "agendado", scheduledFor: schedule } : item),
      ideas: current.ideas.map(item => item.id === video.ideaId ? { ...item, status: "agendado" } : item),
      audit: ([{ id: crypto.randomUUID(), actor: "Você", action: "Publicação agendada", target: video.title, at: new Date().toISOString(), detail: "Modo seguro: exportação manual até conectar YouTube" }, ...current.audit] as AuditEntry[]).slice(0, 500),
    }));
    toast.success("Slot reservado", { description: "O upload continuará manual até o YouTube estar conectado." });
  };

  const retryVideo: StudioActions["retryVideo"] = videoId => {
    const video = state.videos.find(item => item.id === videoId);
    if (!video || video.stage !== "erro") {
      toast.message("Nenhuma nova tentativa necessária", { description: "Apenas jobs com erro podem ser reprocessados." });
      return;
    }
    setState(current => ({
      ...current,
      ideas: current.ideas.map(item => item.id === video.ideaId ? { ...item, status: "assets" } : item),
      audit: ([{ id: crypto.randomUUID(), actor: "Você", action: "Nova tentativa solicitada", target: video.title, at: new Date().toISOString(), detail: "Retornou à etapa de assets" }, ...current.audit] as AuditEntry[]).slice(0, 500),
    }));
    toast.message("Nova tentativa liberada", { description: "Revise os assets e inicie um novo render." });
  };

  const addAsset: StudioActions["addAsset"] = asset => {
    setState(current => ({
      ...current,
      assets: [{ ...asset, id: crypto.randomUUID() }, ...current.assets],
      audit: [{ id: crypto.randomUUID(), actor: "Você", action: "Asset registrado", target: asset.label, at: "agora", detail: `Licença: ${asset.license}` }, ...current.audit],
    }));
  };

  const updateSettings: StudioActions["updateSettings"] = (patch, actor = "Você") => {
    setState(current => ({ ...current, settings: { ...current.settings, ...patch } }));
    addAudit({ actor, action: "Configurações atualizadas", target: "Estúdio", detail: "Alteração registrada" });
    toast.success("Preferências salvas");
  };

  const setAutomation: StudioActions["setAutomation"] = (key, value, actor = "Você") => {
    setState(current => ({
      ...current,
      settings: { ...current.settings, automation: { ...current.settings.automation, [key]: value } },
      audit: [{ id: crypto.randomUUID(), actor, action: "Automação atualizada", target: key, at: "agora", detail: value }, ...current.audit],
    }));
    toast.success(`Etapa ${value.toLowerCase()}`, { description: `Configuração de ${key} atualizada.` });
  };

  const selectAdapter: StudioActions["selectAdapter"] = (id, actor = "Você") => {
    setState(current => {
      const selected = current.adapters.find(adapter => adapter.id === id);
      if (!selected) return current;
      return {
        ...current,
        adapters: current.adapters.map(adapter => adapter.capability === selected.capability ? { ...adapter, active: adapter.id === id } : adapter),
        audit: [{ id: crypto.randomUUID(), actor, action: "Adaptador ativo alterado", target: selected.capability, at: "agora", detail: selected.provider }, ...current.audit],
      };
    });
    toast.success("Adaptador selecionado");
  };

  const requestPlatformConnection: StudioActions["requestPlatformConnection"] = (platform, actor = "Você") => {
    setState(current => ({
      ...current,
      connections: current.connections.map(item => item.platform === platform ? { ...item, state: "Aguardando credenciais" } : item),
      audit: [{ id: crypto.randomUUID(), actor, action: "Conexão solicitada", target: platform === "youtube" ? "YouTube" : "TikTok", at: "agora", detail: "Aguardando credenciais OAuth no cofre" }, ...current.audit],
    }));
    toast.message("Conexão preparada", { description: "Adicione as credenciais no cofre antes de autenticar a plataforma." });
  };

  const addChat: StudioActions["addChat"] = message => setState(current => ({ ...current, chat: [...current.chat, message] }));

  const applyAgentActions: StudioActions["applyAgentActions"] = actions => {
    actions.forEach(action => {
      if (action.type === "setAutomation") setAutomation(action.key, action.value, "Nexo");
      if (action.type === "createIdea") {
        createIdea({ title: action.title, format: action.format, origin: action.origin ?? "Agente" });
        addAudit({ actor: "Nexo", action: "Pauta criada por ferramenta controlada", target: action.title, detail: "Entrou em pesquisa" });
      }
      if (action.type === "selectAdapter") selectAdapter(action.adapterId, "Nexo");
      if (action.type === "connectPlatform") requestPlatformConnection(action.platform, "Nexo");
      if (action.type === "requestConfirmation") toast.warning("Confirmação necessária", { description: action.description });
    });
  };

  const resetDemo = () => {
    const restored = cloneSeed();
    const entry: AuditEntry = { id: crypto.randomUUID(), actor: "Você", action: "Demonstração restaurada", target: "Dados locais", at: new Date().toISOString(), detail: "Conjunto local substituído com confirmação" };
    setState({ ...restored, audit: [entry, ...restored.audit] });
    toast.success("Dados de demonstração restaurados");
  };
  const importDeviceData = () => importState.mutate(deviceSnapshot.current);

  const value = useMemo<StudioContextValue>(() => ({
    ...state, createIdea, updateScript, generateScript, approveScript, requestScriptChanges,
    startRender, approveVideo, requestVideoChanges, scheduleVideo, retryVideo, addAsset, updateSettings,
    setAutomation, selectAdapter, requestPlatformConnection, addChat, applyAgentActions, addAudit, resetDemo, importDeviceData,
  }), [state]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio deve ser usado dentro de StudioProvider");
  return context;
}
