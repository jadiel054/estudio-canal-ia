import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { canGenerateScript } from "@shared/workflowPolicy";
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
  seedState,
} from "@/data/studio";

export type StudioState = {
  /** Versão de concorrência controlada pelo servidor (Neon). */
  version?: number;
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
  publishVideo: (videoId: string) => void;
  setDemoMode: (enabled: boolean) => void;
  clearExampleData: () => void;
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

/** Mensagem clara para conflito de concorrência detectado pelo servidor. */
function isConflict(error: { data?: { code?: string } | null; message: string }) {
  return error.data?.code === "CONFLICT" || /conflito de concorr/i.test(error.message);
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StudioState>(initialState);
  const deviceSnapshot = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [serverBacked, setServerBacked] = useState(false);
  const stateQuery = trpc.studio.state.useQuery(undefined, { retry: 1, refetchOnWindowFocus: false });
  const saveState = trpc.studio.saveState.useMutation({
    onError: error => {
      if (isConflict(error)) {
        toast.warning("Outra alteração aconteceu ao mesmo tempo", { description: "Recarreguei o estado do servidor para evitar sobrescrever algo." });
        void stateQuery.refetch();
      }
    },
  });
  const editorialCommand = trpc.studio.command.useMutation({
    onSuccess: data => setState(data as StudioState),
    onError: error => {
      if (isConflict(error)) {
        toast.error("Conflito: o estado mudou enquanto você agia", { description: "Recarreguei a versão mais recente do Neon. Revise e repita a ação." });
        void stateQuery.refetch();
        return;
      }
      toast.error("Operação recusada pelo servidor", { description: `${error.message} Tente de novo.` });
    },
  });
  const importState = trpc.studio.importState.useMutation({ onSuccess: data => { setState((data as StudioState) ?? deviceSnapshot.current); setServerBacked(true); toast.success("Dados deste aparelho importados para o Neon"); }, onError: error => toast.error("Importação indisponível", { description: `${error.message} Tente de novo.` }) });
  const publish = trpc.studio.publish.useMutation();

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
    const idea: Idea = { id: crypto.randomUUID(), title: params.title, format: params.format, trendId: params.trendId, origin: params.origin ?? (params.trendId ? "Radar" : "Projeto"), angle: params.angle ?? "Tutorial com demonstração real, decisão técnica e resultado mensurável.", audience: "Devs que constroem com IA", keywords: ["programação", "agentes IA", params.format.toLowerCase()], status: "pesquisa", createdAt: new Date().toISOString() };
    editorialCommand.mutate({ operation: "createIdea", title: params.title, format: params.format, origin: idea.origin, trendId: params.trendId, angle: idea.angle });
    return idea;
  };

  const updateScript: StudioActions["updateScript"] = (id, content) => {
    editorialCommand.mutate({ operation: "updateScript", scriptId: id, content });
  };

  const generateScript: StudioActions["generateScript"] = (ideaId, generatedContent) => {
    const idea = state.ideas.find(item => item.id === ideaId);
    if (!idea) return toast.error("Pauta não encontrada");
    const guard = canGenerateScript(idea.status);
    if (!guard.allowed) return toast.error("Geração de roteiro bloqueada", { description: guard.reason });
    const content = generatedContent ?? `# Gancho — 0:00
Mostre o resultado real de: ${idea.title}.`;
    editorialCommand.mutate({ operation: "generateScript", ideaId, content });
  };

  const approveScript: StudioActions["approveScript"] = ideaId => {
    editorialCommand.mutate({ operation: "approveScript", ideaId });
  };

  const requestScriptChanges: StudioActions["requestScriptChanges"] = ideaId => {
    editorialCommand.mutate({ operation: "requestScriptChanges", ideaId });
  };

  const startRender: StudioActions["startRender"] = ideaId => {
    editorialCommand.mutate({ operation: "startRender", ideaId });
  };

  const approveVideo: StudioActions["approveVideo"] = (videoId, options = {}) => {
    editorialCommand.mutate({ operation: "approveVideo", videoId, overrideQa: Boolean(options.overrideQa) });
  };

  const requestVideoChanges: StudioActions["requestVideoChanges"] = videoId => {
    editorialCommand.mutate({ operation: "requestVideoChanges", videoId });
  };

  const scheduleVideo: StudioActions["scheduleVideo"] = videoId => {
    editorialCommand.mutate({ operation: "scheduleVideo", videoId });
  };

  const retryVideo: StudioActions["retryVideo"] = videoId => {
    editorialCommand.mutate({ operation: "retryVideo", videoId });
  };

  const setDemoMode: StudioActions["setDemoMode"] = enabled => {
    editorialCommand.mutate({ operation: "setDemoMode", enabled });
  };

  const clearExampleData: StudioActions["clearExampleData"] = () => {
    editorialCommand.mutate({ operation: "clearExampleData" });
  };

  /** Autorização de publicação verificada no servidor (Portão 2 + simulado + confirmação). */
  const publishVideo: StudioActions["publishVideo"] = videoId => {
    publish.mutate({ videoId }, {
      onSuccess: result => toast.success("Publicação autorizada", { description: result.message }),
      onError: error => toast.error("Publicação bloqueada pelo servidor", { description: `${error.message} Tente de novo.` }),
    });
  };

  const addAsset: StudioActions["addAsset"] = asset => {
    editorialCommand.mutate({ operation: "addAsset", asset });
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
    const entry: AuditEntry = { id: crypto.randomUUID(), actor: "Você", action: "Demonstração restaurada", target: "Dados locais", at: new Date().toISOString(), detail: "Conjunto de exemplo substituído com confirmação" };
    setState({ ...restored, audit: [entry, ...restored.audit] });
    toast.success("Dados de demonstração restaurados");
  };
  const importDeviceData = () => importState.mutate(deviceSnapshot.current);

  const value = useMemo<StudioContextValue>(() => ({
    ...state, createIdea, updateScript, generateScript, approveScript, requestScriptChanges,
    startRender, approveVideo, requestVideoChanges, scheduleVideo, retryVideo, publishVideo, setDemoMode,
    clearExampleData, addAsset, updateSettings,
    setAutomation, selectAdapter, requestPlatformConnection, addChat, applyAgentActions, addAudit, resetDemo, importDeviceData,
  }), [state]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio deve ser usado dentro de StudioProvider");
  return context;
}