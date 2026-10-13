import { getLLMProviderSettings, getLLMUsageSummary, recordLLMUsage, saveLLMProviderSettings } from "./studioRepository";

export type LLMProviderId = "gemini" | "groq";
export type LLMTask = "roteiro" | "qa" | "agente" | "leve";
export type LLMMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string };
export type LLMTool = { name: string; description: string; parameters: Record<string, unknown> };

/**
 * Nível de pensamento do Gemini.
 *
 * A documentação oficial (ai.google.dev/gemini-api/docs/generate-content/thinking)
 * define `thinkingLevel` como o parâmetro recomendado para a série Gemini 3 —
 * `thinkingBudget` continua aceito apenas por compatibilidade e pode piorar o
 * desempenho. Valores válidos: minimal | low | medium | high.
 *
 * Particularidade confirmada na documentação: o `gemini-3.8-flash` NÃO aceita
 * `minimal` (retorna erro) — nesse modelo o valor é rebaixado para `low`.
 */
export type LLMThinkingLevel = "minimal" | "low" | "medium" | "high";
export const THINKING_LEVELS: LLMThinkingLevel[] = ["minimal", "low", "medium", "high"];

export type ProviderSettings = {
  enabled: boolean;
  priority: number;
  tasks: LLMTask[];
  models: Record<LLMTask, string>;
  maxOutputTokens: Record<LLMTask, number>;
  thinkingLevel: Record<LLMTask, LLMThinkingLevel>;
};
export type LLMSettings = Record<LLMProviderId, ProviderSettings> & { taskOrder: Record<LLMTask, LLMProviderId[]> };

type ProviderResult = { text: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>; inputTokens: number; outputTokens: number };
class UpstreamError extends Error { constructor(public readonly status: number | undefined, message: string) { super(message); } }

/**
 * Modelos padrão atualizados para a série Gemini 3.
 *
 * Os modelos 2.5 passaram a ter acesso restrito ("limitamos o acesso aos
 * modelos 2.5 a quem já os usava") e respondem 404 em chaves novas, por isso
 * os padrões usam `gemini-3.8-flash` (roteiro, QA, Nexo) e
 * `gemini-3.5-flash-lite` (tarefas leves).
 */
export const GEMINI_DEFAULT_MODELS: Record<LLMTask, string> = {
  roteiro: "gemini-3.8-flash",
  qa: "gemini-3.8-flash",
  agente: "gemini-3.8-flash",
  leve: "gemini-3.5-flash-lite",
};
const GEMINI_DEFAULT_THINKING: Record<LLMTask, LLMThinkingLevel> = { roteiro: "medium", qa: "medium", agente: "medium", leve: "minimal" };

const DEFAULT_SETTINGS: LLMSettings = {
  gemini: {
    enabled: true,
    priority: 1,
    tasks: ["roteiro", "qa", "agente", "leve"],
    models: { ...GEMINI_DEFAULT_MODELS },
    maxOutputTokens: { roteiro: 3600, qa: 1400, agente: 1200, leve: 700 },
    thinkingLevel: { ...GEMINI_DEFAULT_THINKING },
  },
  groq: {
    enabled: true,
    priority: 2,
    tasks: ["roteiro", "qa", "agente", "leve"],
    models: { roteiro: "openai/gpt-oss-120b", qa: "openai/gpt-oss-120b", agente: "openai/gpt-oss-20b", leve: "openai/gpt-oss-20b" },
    maxOutputTokens: { roteiro: 3600, qa: 1400, agente: 1200, leve: 700 },
    thinkingLevel: { roteiro: "minimal", qa: "minimal", agente: "minimal", leve: "minimal" },
  },
  taskOrder: { roteiro: ["gemini", "groq"], qa: ["gemini", "groq"], agente: ["gemini", "groq"], leve: ["gemini", "groq"] },
};
const PROVIDER_LABELS: Record<LLMProviderId, string> = { gemini: "Gemini", groq: "Groq" };
const TIMEOUT_MS = 20_000;
const breaker = new Map<LLMProviderId, { consecutive429: number; openUntil: number }>();
function hasKey(provider: LLMProviderId) { return Boolean(provider === "gemini" ? process.env.STUDIO_LLM_GEMINI_KEY : process.env.STUDIO_LLM_GROQ_KEY); }

function isThinkingLevel(value: unknown): value is LLMThinkingLevel { return typeof value === "string" && (THINKING_LEVELS as string[]).includes(value); }
function mergeThinking(stored: unknown, fallback: Record<LLMTask, LLMThinkingLevel>): Record<LLMTask, LLMThinkingLevel> {
  const source = (stored ?? {}) as Record<string, unknown>;
  return Object.fromEntries((Object.keys(fallback) as LLMTask[]).map(task => [task, isThinkingLevel(source[task]) ? source[task] : fallback[task]])) as Record<LLMTask, LLMThinkingLevel>;
}
/** Mescla o que está salvo no Neon com os padrões. `thinkingBudget` legado é descartado. */
function mergedSettings(stored: Partial<LLMSettings> | null | undefined): LLMSettings {
  const gemini = stored?.gemini ?? {} as Partial<ProviderSettings>;
  const groq = stored?.groq ?? {} as Partial<ProviderSettings>;
  return {
    gemini: { ...DEFAULT_SETTINGS.gemini, ...gemini, models: { ...DEFAULT_SETTINGS.gemini.models, ...(gemini.models ?? {}) }, maxOutputTokens: { ...DEFAULT_SETTINGS.gemini.maxOutputTokens, ...(gemini.maxOutputTokens ?? {}) }, thinkingLevel: mergeThinking((gemini as any).thinkingLevel, DEFAULT_SETTINGS.gemini.thinkingLevel) },
    groq: { ...DEFAULT_SETTINGS.groq, ...groq, models: { ...DEFAULT_SETTINGS.groq.models, ...(groq.models ?? {}) }, maxOutputTokens: { ...DEFAULT_SETTINGS.groq.maxOutputTokens, ...(groq.maxOutputTokens ?? {}) }, thinkingLevel: mergeThinking((groq as any).thinkingLevel, DEFAULT_SETTINGS.groq.thinkingLevel) },
    taskOrder: { ...DEFAULT_SETTINGS.taskOrder, ...(stored?.taskOrder ?? {}) },
  };
}

/**
 * Traduz o nível pedido para algo que o modelo realmente aceita.
 * - gemini-3.8-flash: `minimal` não é suportado → rebaixa para `low`.
 * - gemini-2.5-*: não conhece `thinkingLevel` → devolvemos thinkingBudget equivalente.
 */
export function resolveThinking(model: string, requested: LLMThinkingLevel): { thinkingLevel?: LLMThinkingLevel; thinkingBudget?: number; adjusted?: LLMThinkingLevel } {
  const id = (model ?? "").toLowerCase();
  if (/^gemini-2\./.test(id)) {
    const budget: Record<LLMThinkingLevel, number> = { minimal: 0, low: 512, medium: 2048, high: 8192 };
    return { thinkingBudget: budget[requested] };
  }
  if (id.includes("3.8-flash") && !id.includes("lite") && requested === "minimal") return { thinkingLevel: "low", adjusted: "low" };
  return { thinkingLevel: requested };
}

function thinkingConfigFor(model: string, requested: LLMThinkingLevel) {
  const resolved = resolveThinking(model, requested);
  return resolved.thinkingBudget !== undefined ? { thinkingBudget: resolved.thinkingBudget } : { thinkingLevel: resolved.thinkingLevel };
}

/**
 * Motivo legível de falha. Nunca inclui corpo da resposta do provedor para não
 * vazar qualquer detalhe sensível; apenas o código HTTP e um rótulo claro.
 */
export function failureReason(error: unknown) {
  if (error instanceof UpstreamError) {
    if (error.status === 404) return "modelo indisponível para esta chave";
    if (error.status === 400) return "requisição recusada (verifique o modelo escolhido)";
    if (error.status === 401 || error.status === 403) return "chave inválida ou sem permissão";
    if (error.status === 429) return "limite 429";
    if (error.status && error.status >= 500) return "erro 5xx";
    if (error.status) return `erro HTTP ${error.status}`;
  }
  if (error instanceof Error && error.message === "timeout") return "timeout";
  return "erro de conexão";
}
export function failureHint(reason: string) {
  if (reason === "modelo indisponível para esta chave") return "Modelo indisponível para esta chave. Escolha outro modelo em Configurações.";
  if (reason === "chave inválida ou sem permissão") return "Chave inválida ou sem permissão. Revise a chave no cofre da Vercel.";
  return "Verifique a chave e tente novamente.";
}
function timeoutSignal() { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS); return { controller, cleanup: () => clearTimeout(timer) }; }
function normalizeMessages(messages: LLMMessage[]) { const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n"); const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })); return { system, contents }; }
function recordBreakerFailure(provider: LLMProviderId, status?: number) { const state = breaker.get(provider) ?? { consecutive429: 0, openUntil: 0 }; state.consecutive429 = status === 429 ? state.consecutive429 + 1 : 0; if (state.consecutive429 >= 3) state.openUntil = Date.now() + 5 * 60_000; breaker.set(provider, state); }
function isCircuitOpen(provider: LLMProviderId) { const state = breaker.get(provider); return Boolean(state?.openUntil && state.openUntil > Date.now()); }
function recordBreakerSuccess(provider: LLMProviderId) { breaker.set(provider, { consecutive429: 0, openUntil: 0 }); }

async function callGemini(messages: LLMMessage[], task: LLMTask, settings: LLMSettings, tools?: LLMTool[]): Promise<ProviderResult> {
  const key = process.env.STUDIO_LLM_GEMINI_KEY; if (!key) throw new Error("Gemini não configurado"); const config = settings.gemini; const { system, contents } = normalizeMessages(messages); const { controller, cleanup } = timeoutSignal();
  try {
    const model = config.models[task];
    const body: Record<string, unknown> = { systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { maxOutputTokens: config.maxOutputTokens[task], temperature: 0.35, thinkingConfig: thinkingConfigFor(model, config.thinkingLevel[task]) } };
    if (tools?.length) body.tools = [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
    if (!response.ok) throw new UpstreamError(response.status, `Gemini ${response.status}`);
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const parts = data.candidates?.[0]?.content?.parts ?? []; const text = parts.map(part => part.text ?? "").join("").trim(); const toolCalls = parts.flatMap(part => part.functionCall ? [{ name: part.functionCall.name, arguments: part.functionCall.args ?? {} }] : []);
    if (!text && !toolCalls.length) throw new Error("Gemini retornou resposta vazia");
    recordBreakerSuccess("gemini"); return { text, toolCalls: toolCalls.length ? toolCalls : undefined, inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error("timeout"); if (error instanceof UpstreamError) recordBreakerFailure("gemini", error.status); throw error; } finally { cleanup(); }
}
async function callGroq(messages: LLMMessage[], task: LLMTask, settings: LLMSettings, tools?: LLMTool[]): Promise<ProviderResult> {
  const key = process.env.STUDIO_LLM_GROQ_KEY; if (!key) throw new Error("Groq não configurado"); const config = settings.groq; const { controller, cleanup } = timeoutSignal();
  try {
    const payload: Record<string, unknown> = { model: config.models[task], messages, max_tokens: config.maxOutputTokens[task], temperature: 0.35 }; if (tools?.length) { payload.tools = tools.map(tool => ({ type: "function", function: tool })); payload.tool_choice = "auto"; }
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(payload) });
    if (!response.ok) throw new UpstreamError(response.status, `Groq ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = data.choices?.[0]?.message; const text = message?.content?.trim() ?? ""; const toolCalls = (message?.tool_calls ?? []).flatMap(call => call.function?.name ? [{ name: call.function.name, arguments: JSON.parse(call.function.arguments || "{}") as Record<string, unknown> }] : []);
    if (!text && !toolCalls.length) throw new Error("Groq retornou resposta vazia"); recordBreakerSuccess("groq"); return { text, toolCalls: toolCalls.length ? toolCalls : undefined, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error("timeout"); if (error instanceof UpstreamError) recordBreakerFailure("groq", error.status); throw error; } finally { cleanup(); }
}
const PROVIDERS: LLMProviderId[] = ["gemini", "groq"];
function describe(id: LLMProviderId, settings: LLMSettings) {
  const config = settings[id];
  return {
    id,
    label: PROVIDER_LABELS[id],
    ...config,
    // Nível efetivamente enviado por tarefa (considera o ajuste exigido pelo modelo).
    effectiveThinkingLevel: Object.fromEntries((Object.keys(config.models) as LLMTask[]).map(task => [task, resolveThinking(config.models[task], config.thinkingLevel[task]).thinkingLevel ?? config.thinkingLevel[task]])) as Record<LLMTask, LLMThinkingLevel>,
    configured: hasKey(id),
    circuitOpen: isCircuitOpen(id),
  };
}
export async function getProviderSettings() { const settings = mergedSettings(await getLLMProviderSettings()); return [...PROVIDERS].sort((a, b) => settings[a].priority - settings[b].priority).map(id => describe(id, settings)); }
export async function getRawProviderSettings() { return mergedSettings(await getLLMProviderSettings()); }
export async function updateProviderSettings(patch: Partial<LLMSettings>) {
  const stored = await getLLMProviderSettings();
  const settings = mergedSettings({ ...(stored ?? {}), ...patch } as Partial<LLMSettings>);
  await saveLLMProviderSettings(settings as unknown as { gemini: unknown; groq: unknown });
  return [...PROVIDERS].sort((a, b) => settings[a].priority - settings[b].priority).map(id => describe(id, settings));
}
export async function testProvider(provider: LLMProviderId) {
  const started = Date.now();
  try {
    const settings = mergedSettings(await getLLMProviderSettings());
    const result = provider === "gemini" ? await callGemini([{ role: "user", content: "Responda apenas: conexão OK" }], "leve", settings) : await callGroq([{ role: "user", content: "Responda apenas: conexão OK" }], "leve", settings);
    await recordLLMUsage({ provider, task: "leve", outcome: "success", reason: "teste de conexão", latencyMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return { ok: true as const, provider, model: settings[provider].models.leve, message: "Conexão OK", latencyMs: Date.now() - started };
  } catch (error) {
    const reason = failureReason(error);
    await recordLLMUsage({ provider, task: "leve", outcome: "failure", reason, latencyMs: Date.now() - started });
    return { ok: false as const, provider, message: `Falha: ${reason}. ${failureHint(reason)}` };
  }
}
export async function completeWithFallback(task: LLMTask, messages: LLMMessage[], preferred?: LLMProviderId, tools?: LLMTool[]) {
  const settings = mergedSettings(await getLLMProviderSettings()); const preferredOrder = preferred ? [preferred, ...settings.taskOrder[task].filter(id => id !== preferred)] : settings.taskOrder[task]; const ordered = preferredOrder.filter(id => settings[id].enabled && settings[id].tasks.includes(task) && hasKey(id) && !isCircuitOpen(id)); if (!ordered.length) throw new Error("Nenhum provedor configurado ou disponível para esta tarefa. Tente de novo."); const failures: string[] = [];
  for (const provider of ordered) { const started = Date.now(); try { const result = provider === "gemini" ? await callGemini(messages, task, settings, tools) : await callGroq(messages, task, settings, tools); const switched = failures.length > 0; await recordLLMUsage({ provider, task, outcome: "success", reason: switched ? `fallback após ${failures.join(", ")}` : "provedor prioritário", latencyMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens }); return { ...result, provider, model: settings[provider].models[task], switched, fallbackReason: switched ? failures.join(", ") : undefined }; } catch (error) { failures.push(`${PROVIDER_LABELS[provider]}: ${failureReason(error)}`); await recordLLMUsage({ provider, task, outcome: "failure", reason: failureReason(error), latencyMs: Date.now() - started }); } }
  throw new Error(`Todos os provedores falharam (${failures.join("; ")}). Tente de novo em instantes.`);
}
export async function getProviderUsage() { return getLLMUsageSummary(); }