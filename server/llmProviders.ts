import { getLLMProviderSettings, getLLMUsageSummary, recordLLMUsage, saveLLMProviderSettings } from "./studioRepository";

export type LLMProviderId = "gemini" | "groq";
export type LLMTask = "roteiro" | "qa" | "agente" | "leve";
export type LLMMessage = { role: "system" | "user" | "assistant"; content: string };
export type ProviderSettings = {
  enabled: boolean;
  priority: number;
  tasks: LLMTask[];
};
export type LLMSettings = Record<LLMProviderId, ProviderSettings>;

const DEFAULT_SETTINGS: LLMSettings = {
  gemini: { enabled: true, priority: 1, tasks: ["roteiro", "qa", "agente"] },
  groq: { enabled: true, priority: 2, tasks: ["roteiro", "qa", "agente", "leve"] },
};

const PROVIDER_LABELS: Record<LLMProviderId, string> = { gemini: "Gemini", groq: "Groq" };
const MODEL_BY_TASK: Record<LLMProviderId, Record<LLMTask, string>> = {
  gemini: { roteiro: "gemini-2.5-flash", qa: "gemini-2.5-flash", agente: "gemini-2.5-flash", leve: "gemini-2.5-flash-lite" },
  groq: { roteiro: "llama-3.3-70b-versatile", qa: "llama-3.3-70b-versatile", agente: "llama-3.1-8b-instant", leve: "llama-3.1-8b-instant" },
};
const TIMEOUT_MS = 20_000;

function hasKey(provider: LLMProviderId) {
  return Boolean(provider === "gemini" ? process.env.STUDIO_LLM_GEMINI_KEY : process.env.STUDIO_LLM_GROQ_KEY);
}
function mergedSettings(stored: Partial<LLMSettings> | null | undefined): LLMSettings {
  return { gemini: { ...DEFAULT_SETTINGS.gemini, ...(stored?.gemini ?? {}) }, groq: { ...DEFAULT_SETTINGS.groq, ...(stored?.groq ?? {}) } };
}
function failureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("429")) return "limite 429";
  if (message.includes("timeout")) return "timeout";
  if (/\b5\d\d\b/.test(message)) return "erro 5xx";
  if (/\b4\d\d\b/.test(message)) return "erro HTTP";
  return "erro de conexão";
}
function timeoutSignal() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { controller, cleanup: () => clearTimeout(timer) };
}
function normalizeMessages(messages: LLMMessage[]) {
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  return { system, contents };
}

async function callGemini(messages: LLMMessage[], task: LLMTask) {
  const key = process.env.STUDIO_LLM_GEMINI_KEY;
  if (!key) throw new Error("Gemini não configurado");
  const { system, contents } = normalizeMessages(messages);
  const { controller, cleanup } = timeoutSignal();
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_BY_TASK.gemini[task]}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { maxOutputTokens: 1400, temperature: 0.35 } }),
    });
    if (!response.ok) throw new Error(`Gemini ${response.status} ${await response.text()}`);
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
    const text = data.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini retornou resposta vazia");
    return { text, inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Gemini timeout");
    throw error;
  } finally { cleanup(); }
}

async function callGroq(messages: LLMMessage[], task: LLMTask) {
  const key = process.env.STUDIO_LLM_GROQ_KEY;
  if (!key) throw new Error("Groq não configurado");
  const { controller, cleanup } = timeoutSignal();
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: controller.signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL_BY_TASK.groq[task], messages, max_tokens: 1400, temperature: 0.35 }),
    });
    if (!response.ok) throw new Error(`Groq ${response.status} ${await response.text()}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Groq retornou resposta vazia");
    return { text, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Groq timeout");
    throw error;
  } finally { cleanup(); }
}

export async function getProviderSettings() {
  const settings = mergedSettings(await getLLMProviderSettings());
  return (Object.keys(settings) as LLMProviderId[]).sort((a, b) => settings[a].priority - settings[b].priority).map(id => ({ id, label: PROVIDER_LABELS[id], ...settings[id], configured: hasKey(id), modelByTask: MODEL_BY_TASK[id] }));
}
export async function updateProviderSettings(patch: Partial<LLMSettings>) {
  const settings = mergedSettings({ ...(await getLLMProviderSettings()), ...patch });
  await saveLLMProviderSettings(settings);
  return getProviderSettingsAfterSave(settings);
}
async function getProviderSettingsAfterSave(settings: LLMSettings) {
  return (Object.keys(settings) as LLMProviderId[]).sort((a, b) => settings[a].priority - settings[b].priority).map(id => ({ id, label: PROVIDER_LABELS[id], ...settings[id], configured: hasKey(id), modelByTask: MODEL_BY_TASK[id] }));
}

export async function testProvider(provider: LLMProviderId) {
  const started = Date.now();
  try {
    const result = provider === "gemini" ? await callGemini([{ role: "user", content: "Responda apenas: conexão OK" }], "leve") : await callGroq([{ role: "user", content: "Responda apenas: conexão OK" }], "leve");
    await recordLLMUsage({ provider, task: "leve", outcome: "success", reason: "teste de conexão", latencyMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return { ok: true as const, provider, message: "Conexão OK", latencyMs: Date.now() - started };
  } catch (error) {
    const reason = failureReason(error);
    await recordLLMUsage({ provider, task: "leve", outcome: "failure", reason, latencyMs: Date.now() - started });
    return { ok: false as const, provider, message: `Falha: ${reason}. Verifique a chave e tente novamente.` };
  }
}

export async function completeWithFallback(task: LLMTask, messages: LLMMessage[], preferred?: LLMProviderId) {
  const settings = mergedSettings(await getLLMProviderSettings());
  const ordered = (Object.keys(settings) as LLMProviderId[]).filter(id => settings[id].enabled && settings[id].tasks.includes(task) && hasKey(id)).sort((a, b) => settings[a].priority - settings[b].priority);
  if (preferred && ordered.includes(preferred)) ordered.unshift(ordered.splice(ordered.indexOf(preferred), 1)[0]);
  if (!ordered.length) throw new Error("Nenhum provedor configurado para esta tarefa. Adicione uma chave ou ative um provedor e tente de novo.");
  const failures: string[] = [];
  for (const provider of ordered) {
    const started = Date.now();
    try {
      const result = provider === "gemini" ? await callGemini(messages, task) : await callGroq(messages, task);
      const switched = failures.length > 0;
      await recordLLMUsage({ provider, task, outcome: "success", reason: switched ? `fallback após ${failures.join(", ")}` : "provedor prioritário", latencyMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      return { ...result, provider, switched, fallbackReason: switched ? failures.join(", ") : undefined };
    } catch (error) {
      const reason = failureReason(error);
      failures.push(`${PROVIDER_LABELS[provider]}: ${reason}`);
      await recordLLMUsage({ provider, task, outcome: "failure", reason, latencyMs: Date.now() - started });
    }
  }
  throw new Error(`Todos os provedores falharam (${failures.join("; ")}). Tente de novo em instantes.`);
}

export async function getProviderUsage() { return getLLMUsageSummary(); }
