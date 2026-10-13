import { getLLMProviderSettings, getLLMUsageSummary, recordLLMUsage, saveLLMProviderSettings } from "./studioRepository";

export type LLMProviderId = "gemini" | "groq";
export type LLMTask = "roteiro" | "qa" | "agente" | "leve";
export type LLMMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string };
export type LLMTool = { name: string; description: string; parameters: Record<string, unknown> };
export type ProviderSettings = { enabled: boolean; priority: number; tasks: LLMTask[]; models: Record<LLMTask, string>; maxOutputTokens: Record<LLMTask, number>; thinkingBudget: number };
export type LLMSettings = Record<LLMProviderId, ProviderSettings>;

type ProviderResult = { text: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>; inputTokens: number; outputTokens: number };
class UpstreamError extends Error { constructor(public readonly status: number | undefined, message: string) { super(message); } }
const DEFAULT_SETTINGS: LLMSettings = {
  gemini: { enabled: true, priority: 1, tasks: ["roteiro", "qa", "agente"], models: { roteiro: "gemini-2.5-flash", qa: "gemini-2.5-flash", agente: "gemini-2.5-flash", leve: "gemini-2.5-flash-lite" }, maxOutputTokens: { roteiro: 3600, qa: 1400, agente: 1200, leve: 700 }, thinkingBudget: 256 },
  groq: { enabled: true, priority: 2, tasks: ["roteiro", "qa", "agente", "leve"], models: { roteiro: "openai/gpt-oss-120b", qa: "openai/gpt-oss-120b", agente: "openai/gpt-oss-20b", leve: "openai/gpt-oss-20b" }, maxOutputTokens: { roteiro: 3600, qa: 1400, agente: 1200, leve: 700 }, thinkingBudget: 0 },
};
const PROVIDER_LABELS: Record<LLMProviderId, string> = { gemini: "Gemini", groq: "Groq" };
const TIMEOUT_MS = 20_000;
const breaker = new Map<LLMProviderId, { consecutive429: number; openUntil: number }>();
function hasKey(provider: LLMProviderId) { return Boolean(provider === "gemini" ? process.env.STUDIO_LLM_GEMINI_KEY : process.env.STUDIO_LLM_GROQ_KEY); }
function mergedSettings(stored: Partial<LLMSettings> | null | undefined): LLMSettings {
  return { gemini: { ...DEFAULT_SETTINGS.gemini, ...(stored?.gemini ?? {}), models: { ...DEFAULT_SETTINGS.gemini.models, ...(stored?.gemini?.models ?? {}) }, maxOutputTokens: { ...DEFAULT_SETTINGS.gemini.maxOutputTokens, ...(stored?.gemini?.maxOutputTokens ?? {}) } }, groq: { ...DEFAULT_SETTINGS.groq, ...(stored?.groq ?? {}), models: { ...DEFAULT_SETTINGS.groq.models, ...(stored?.groq?.models ?? {}) }, maxOutputTokens: { ...DEFAULT_SETTINGS.groq.maxOutputTokens, ...(stored?.groq?.maxOutputTokens ?? {}) } } };
}
function failureReason(error: unknown) { if (error instanceof UpstreamError) { if (error.status === 429) return "limite 429"; if (error.status && error.status >= 500) return "erro 5xx"; if (error.status) return `erro HTTP ${error.status}`; } if (error instanceof Error && error.message === "timeout") return "timeout"; return "erro de conexão"; }
function timeoutSignal() { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS); return { controller, cleanup: () => clearTimeout(timer) }; }
function normalizeMessages(messages: LLMMessage[]) { const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n"); const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })); return { system, contents }; }
function recordBreakerFailure(provider: LLMProviderId, status?: number) { const state = breaker.get(provider) ?? { consecutive429: 0, openUntil: 0 }; state.consecutive429 = status === 429 ? state.consecutive429 + 1 : 0; if (state.consecutive429 >= 3) state.openUntil = Date.now() + 5 * 60_000; breaker.set(provider, state); }
function isCircuitOpen(provider: LLMProviderId) { const state = breaker.get(provider); return Boolean(state?.openUntil && state.openUntil > Date.now()); }
function recordBreakerSuccess(provider: LLMProviderId) { breaker.set(provider, { consecutive429: 0, openUntil: 0 }); }

async function callGemini(messages: LLMMessage[], task: LLMTask, settings: LLMSettings, tools?: LLMTool[]): Promise<ProviderResult> {
  const key = process.env.STUDIO_LLM_GEMINI_KEY; if (!key) throw new Error("Gemini não configurado"); const config = settings.gemini; const { system, contents } = normalizeMessages(messages); const { controller, cleanup } = timeoutSignal();
  try {
    const body: Record<string, unknown> = { systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { maxOutputTokens: config.maxOutputTokens[task], temperature: 0.35, thinkingConfig: { thinkingBudget: config.thinkingBudget } } };
    if (tools?.length) body.tools = [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.models[task]}:generateContent`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
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
export async function getProviderSettings() { const settings = mergedSettings(await getLLMProviderSettings()); return (Object.keys(settings) as LLMProviderId[]).sort((a, b) => settings[a].priority - settings[b].priority).map(id => ({ id, label: PROVIDER_LABELS[id], ...settings[id], configured: hasKey(id), circuitOpen: isCircuitOpen(id) })); }
export async function getRawProviderSettings() { return mergedSettings(await getLLMProviderSettings()); }
export async function updateProviderSettings(patch: Partial<LLMSettings>) { const settings = mergedSettings({ ...(await getLLMProviderSettings()), ...patch }); await saveLLMProviderSettings(settings); return getProviderSettingsAfterSave(settings); }
async function getProviderSettingsAfterSave(settings: LLMSettings) { return (Object.keys(settings) as LLMProviderId[]).sort((a, b) => settings[a].priority - settings[b].priority).map(id => ({ id, label: PROVIDER_LABELS[id], ...settings[id], configured: hasKey(id), circuitOpen: isCircuitOpen(id) })); }
export async function testProvider(provider: LLMProviderId) { const started = Date.now(); try { const settings = mergedSettings(await getLLMProviderSettings()); const result = provider === "gemini" ? await callGemini([{ role: "user", content: "Responda apenas: conexão OK" }], "leve", settings) : await callGroq([{ role: "user", content: "Responda apenas: conexão OK" }], "leve", settings); await recordLLMUsage({ provider, task: "leve", outcome: "success", reason: "teste de conexão", latencyMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens }); return { ok: true as const, provider, message: "Conexão OK", latencyMs: Date.now() - started }; } catch (error) { const reason = failureReason(error); await recordLLMUsage({ provider, task: "leve", outcome: "failure", reason, latencyMs: Date.now() - started }); return { ok: false as const, provider, message: `Falha: ${reason}. Verifique a chave e tente novamente.` }; } }
export async function completeWithFallback(task: LLMTask, messages: LLMMessage[], preferred?: LLMProviderId, tools?: LLMTool[]) {
  const settings = mergedSettings(await getLLMProviderSettings()); const ordered = (Object.keys(settings) as LLMProviderId[]).filter(id => settings[id].enabled && settings[id].tasks.includes(task) && hasKey(id) && !isCircuitOpen(id)).sort((a, b) => settings[a].priority - settings[b].priority); if (preferred && ordered.includes(preferred)) ordered.unshift(ordered.splice(ordered.indexOf(preferred), 1)[0]); if (!ordered.length) throw new Error("Nenhum provedor configurado ou disponível para esta tarefa. Tente de novo."); const failures: string[] = [];
  for (const provider of ordered) { const started = Date.now(); try { const result = provider === "gemini" ? await callGemini(messages, task, settings, tools) : await callGroq(messages, task, settings, tools); const switched = failures.length > 0; await recordLLMUsage({ provider, task, outcome: "success", reason: switched ? `fallback após ${failures.join(", ")}` : "provedor prioritário", latencyMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens }); return { ...result, provider, switched, fallbackReason: switched ? failures.join(", ") : undefined }; } catch (error) { failures.push(`${PROVIDER_LABELS[provider]}: ${failureReason(error)}`); await recordLLMUsage({ provider, task, outcome: "failure", reason: failureReason(error), latencyMs: Date.now() - started }); } }
  throw new Error(`Todos os provedores falharam (${failures.join("; ")}). Tente de novo em instantes.`);
}
export async function getProviderUsage() { return getLLMUsageSummary(); }
