export type VideoStage =
  | "ideia"
  | "pesquisa"
  | "roteiro"
  | "aguarda_aprov_roteiro"
  | "assets"
  | "render"
  | "qa"
  | "aguarda_aprov_video"
  | "aprovado_para_agenda"
  | "agendado"
  | "publicado"
  | "ajuste_pedido"
  | "rejeitado"
  | "erro";

export type Platform = "youtube" | "tiktok";
export type Format = "Longo" | "Short" | "Live";

export type Trend = {
  id: string;
  title: string;
  source: "Hacker News" | "GitHub" | "dev.to" | "YouTube";
  score: number;
  growth: string;
  fit: string;
  gap: string;
  url: string;
  collectedAt: string;
  tags: string[];
};

export type Idea = {
  id: string;
  trendId?: string;
  origin: "Radar" | "Projeto" | "Agente";
  title: string;
  format: Format;
  angle: string;
  audience: string;
  keywords: string[];
  status: VideoStage;
  createdAt: string;
};

export type Script = {
  id: string;
  ideaId: string;
  version: number;
  title: string;
  content: string;
  status: "Rascunho" | "Aguardando aprovação" | "Aprovado" | "Ajuste pedido";
  updatedAt: string;
};

export type Asset = {
  id: string;
  scriptId: string;
  type: "Tela" | "Código" | "Voz" | "Música" | "Legenda";
  label: string;
  license: string;
  status: "Pronto" | "Pendente" | "Verificar";
};

export type Video = {
  id: string;
  ideaId: string;
  scriptId: string;
  title: string;
  format: Format;
  stage: VideoStage;
  duration: string;
  qa: { label: string; passed: boolean; note: string }[];
  synthetic: boolean;
  scheduledFor?: string;
};

export type RenderJob = {
  id: string;
  videoId: string;
  status: "queued" | "rendering" | "qa" | "succeeded" | "failed";
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type Adapter = {
  id: string;
  capability: "LLM" | "Voz / TTS" | "Transcrição" | "Render" | "Pesquisa";
  provider: string;
  plan: "Gratuito" | "Pago";
  active: boolean;
  fallback: boolean;
  status: "Pronto" | "Limite" | "Desativado";
};

export type Connection = {
  platform: Platform;
  label: string;
  state: "Não conectado" | "Pronto para conectar" | "Aguardando credenciais" | "Conectado";
  detail: string;
  enabled: boolean;
};

export type AuditEntry = {
  id: string;
  actor: "Você" | "Nexo" | "Sistema";
  action: string;
  target: string;
  at: string;
  detail?: string;
};

export type ChatMessage = {
  id: string;
  sender: "nexo" | "user";
  text: string;
  at: string;
  actions?: AgentAction[];
};

export type AgentAction =
  | { type: "setAutomation"; key: keyof AutomationSettings; value: "Automática" | "Manual" }
  | { type: "createIdea"; title: string; format: Format; origin?: Idea["origin"] }
  | { type: "selectAdapter"; adapterId: string }
  | { type: "requestConfirmation"; subject: string; description: string; confirmationId?: string }
  | { type: "connectPlatform"; platform: Platform };

export type AutomationSettings = {
  radar: "Automática" | "Manual";
  roteiro: "Automática" | "Manual";
  producao: "Automática" | "Manual";
  publicacao: "Automática" | "Manual";
};

export type StudioSettings = {
  automation: AutomationSettings;
  weeklyGoal: { longos: number; shorts: number; lives: number };
  monthlyCap: number;
  voiceMode: "TTS" | "Sua voz" | "Música + texto";
  autonomy: "Revisão total" | "Amostra";
};

const now = "Hoje, 00:46";

export const stageMeta: Record<VideoStage, { label: string; tone: string; next?: string }> = {
  ideia: { label: "Ideia", tone: "slate", next: "Pesquisa" },
  pesquisa: { label: "Pesquisa", tone: "violet", next: "Roteiro" },
  roteiro: { label: "Roteiro", tone: "violet", next: "Aguardar aprovação" },
  aguarda_aprov_roteiro: { label: "Aprovar roteiro", tone: "amber", next: "Assets" },
  assets: { label: "Assets", tone: "blue", next: "Render" },
  render: { label: "Renderizando", tone: "blue", next: "QA" },
  qa: { label: "QA", tone: "violet", next: "Aprovar vídeo" },
  aguarda_aprov_video: { label: "Aprovar vídeo", tone: "amber", next: "Agendar" },
  aprovado_para_agenda: { label: "Aprovado", tone: "lime", next: "Agendar" },
  agendado: { label: "Agendado", tone: "lime", next: "Publicado" },
  publicado: { label: "Publicado", tone: "lime" },
  ajuste_pedido: { label: "Ajuste pedido", tone: "coral", next: "Revisar" },
  rejeitado: { label: "Rejeitado", tone: "coral" },
  erro: { label: "Erro", tone: "coral", next: "Tentar de novo" },
};

export const seedState = {
  trends: [
    {
      id: "trend-mcp",
      title: "MCP Apps: o padrão para agentes realmente usarem suas ferramentas",
      source: "Hacker News",
      score: 94,
      growth: "+128% em 7 dias",
      fit: "Alta aderência a agentes e stack",
      gap: "Poucos tutoriais práticos em PT-BR",
      url: "https://modelcontextprotocol.io",
      collectedAt: "há 36 min",
      tags: ["MCP", "Agentes", "TypeScript"],
    },
    {
      id: "trend-pydantic",
      title: "Pydantic AI + FastAPI: agentes tipados que você consegue depurar",
      source: "GitHub",
      score: 88,
      growth: "+74% em 7 dias",
      fit: "Tutorial técnico com demonstração real",
      gap: "Lacuna clara de projeto completo em PT-BR",
      url: "https://github.com/pydantic/pydantic-ai",
      collectedAt: "há 1h",
      tags: ["Python", "FastAPI", "Pydantic AI"],
    },
    {
      id: "trend-neon",
      title: "Postgres serverless para memória e jobs de agentes",
      source: "dev.to",
      score: 81,
      growth: "+56% em 7 dias",
      fit: "Bom encaixe com projetos reais",
      gap: "Ângulo de custo zero ainda pouco explorado",
      url: "https://neon.tech",
      collectedAt: "há 3h",
      tags: ["Postgres", "Neon", "Arquitetura"],
    },
  ] satisfies Trend[],
  ideas: [
    {
      id: "idea-mcp",
      trendId: "trend-mcp",
      origin: "Radar",
      title: "Construa um agente MCP que revisa PRs com ferramentas reais",
      format: "Longo",
      angle: "Do zero ao servidor MCP, com uma ferramenta de revisão de código funcional.",
      audience: "Dev pleno que já usa TypeScript",
      keywords: ["MCP", "agente IA", "TypeScript"],
      status: "aguarda_aprov_roteiro",
      createdAt: now,
    },
    {
      id: "idea-zarith",
      origin: "Projeto",
      title: "Como construí o Zarith: do briefing ao agente de produto",
      format: "Longo",
      angle: "Mostrando escolhas reais, erros e o fluxo que funcionou.",
      audience: "Devs criando produtos com IA",
      keywords: ["agentes", "produto", "tutorial"],
      status: "aguarda_aprov_video",
      createdAt: "Ontem, 21:10",
    },
  ] satisfies Idea[],
  scripts: [
    {
      id: "script-mcp",
      ideaId: "idea-mcp",
      version: 3,
      title: "MCP na prática: um agente que revisa PRs",
      content: `# Gancho — 0:00\n"Um agente que só conversa é interessante. Um agente que usa suas ferramentas e abre um comentário útil no PR muda o jogo."\n\n# Problema — 0:18\nMostre por que funções soltas e prompts gigantes não escalam quando o agente precisa acessar sistemas reais.\n\n# Demonstração real — 1:02\nAbra o projeto. Construa o servidor MCP, registre a ferramenta de análise e rode um PR de exemplo. Mostre também uma falha e como você a depurou.\n\n# Resultado — 6:40\nCompare a revisão manual com o comentário estruturado produzido pelo agente.\n\n# CTA — 7:20\n"O repositório e os próximos cortes estão na descrição. Qual ferramenta o seu agente deveria aprender primeiro?"`,
      status: "Aguardando aprovação",
      updatedAt: "há 12 min",
    },
    {
      id: "script-zarith",
      ideaId: "idea-zarith",
      version: 1,
      title: "Como construí o Zarith",
      content: "Roteiro aprovado. Produção de tela, código e legendas em andamento.",
      status: "Aprovado",
      updatedAt: "ontem",
    },
  ] satisfies Script[],
  assets: [
    { id: "asset-1", scriptId: "script-zarith", type: "Tela", label: "Captura: briefing inicial", license: "Original", status: "Pronto" },
    { id: "asset-2", scriptId: "script-zarith", type: "Código", label: "Demo do fluxo do agente", license: "MIT", status: "Verificar" },
    { id: "asset-3", scriptId: "script-zarith", type: "Voz", label: "Narração TTS · Piper pt-BR", license: "Open source", status: "Pronto" },
  ] satisfies Asset[],
  videos: [
    {
      id: "video-zarith",
      ideaId: "idea-zarith",
      scriptId: "script-zarith",
      title: "Como construí o Zarith: um agente de produto que funciona",
      format: "Longo",
      stage: "aguarda_aprov_video",
      duration: "08:24",
      synthetic: false,
      qa: [
        { label: "Duração e ritmo", passed: true, note: "Dentro da meta de 7–10 min" },
        { label: "Legenda em PT-BR", passed: true, note: "98% sincronizada" },
        { label: "Licenças dos assets", passed: false, note: "Confirmar licença do snippet de código" },
        { label: "Demonstração original", passed: true, note: "Tela e projeto próprios" },
      ],
    },
  ] satisfies Video[],
  renderJobs: [] satisfies RenderJob[],
  adapters: [
    { id: "adapter-gpt", capability: "LLM", provider: "Manus AI · GPT-5 mini", plan: "Gratuito", active: true, fallback: false, status: "Pronto" },
    { id: "adapter-groq", capability: "LLM", provider: "Groq", plan: "Gratuito", active: false, fallback: true, status: "Pronto" },
    { id: "adapter-piper", capability: "Voz / TTS", provider: "Piper pt-BR", plan: "Gratuito", active: true, fallback: false, status: "Pronto" },
    { id: "adapter-whisper", capability: "Transcrição", provider: "Whisper local", plan: "Gratuito", active: true, fallback: false, status: "Pronto" },
    { id: "adapter-ffmpeg", capability: "Render", provider: "FFmpeg + GitHub Actions", plan: "Gratuito", active: true, fallback: false, status: "Pronto" },
    { id: "adapter-radar", capability: "Pesquisa", provider: "HN + GitHub + dev.to", plan: "Gratuito", active: true, fallback: false, status: "Pronto" },
  ] satisfies Adapter[],
  connections: [
    { platform: "youtube", label: "YouTube", state: "Pronto para conectar", detail: "OAuth com escopos mínimos; uploads ficam bloqueados até aprovação.", enabled: false },
    { platform: "tiktok", label: "TikTok", state: "Pronto para conectar", detail: "Adaptador já criado; conecte quando tiver a app e as credenciais.", enabled: false },
  ] satisfies Connection[],
  settings: {
    automation: { radar: "Automática", roteiro: "Automática", producao: "Manual", publicacao: "Manual" },
    weeklyGoal: { longos: 2, shorts: 4, lives: 1 },
    monthlyCap: 0,
    voiceMode: "TTS",
    autonomy: "Revisão total",
  } satisfies StudioSettings,
  audit: [
    { id: "audit-1", actor: "Sistema", action: "QA finalizado", target: "Como construí o Zarith", at: "há 9 min", detail: "1 item para verificar" },
    { id: "audit-2", actor: "Nexo", action: "Tendência pontuada", target: "MCP Apps", at: "há 36 min", detail: "Score 94/100" },
    { id: "audit-3", actor: "Você", action: "Pauta criada", target: "MCP que revisa PRs", at: "hoje, 00:14" },
  ] satisfies AuditEntry[],
  chat: [
    {
      id: "chat-welcome",
      sender: "nexo",
      text: "Boa noite. Encontrei 3 sinais fortes no Radar. O tema de MCP tem a melhor combinação de crescimento, aderência ao nicho e lacuna em PT-BR. Quer que eu transforme isso em um roteiro longo?",
      at: now,
    },
  ] satisfies ChatMessage[],
};
