import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { NEXO_SYSTEM_PROMPT } from "./agent/systemPrompt";
import { agentTools, executeAgentTool } from "./agent/tools";
import { studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { completeWithFallback, getProviderSettings, getProviderUsage, testProvider, updateProviderSettings, type LLMMessage, type LLMProviderId, type LLMTask } from "./llmProviders";
import { authConfigSummary, clearSessionCookie, loginOwner } from "./auth";

const rate = new Map<string, { started: number; calls: number }>();
function enforceLLMRateLimit(userId: string) {
  const now = Date.now(); const current = rate.get(userId);
  if (!current || now - current.started >= 60_000) { rate.set(userId, { started: now, calls: 1 }); return; }
  if (current.calls >= 20) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite de 20 chamadas LLM por minuto atingido. Tente novamente em instantes." });
  current.calls += 1;
}
const taskSchema = z.enum(["roteiro", "qa", "agente", "leve"]);
const messageSchema = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(20_000) });

async function runAgent(message: string) {
  const messages: LLMMessage[] = [
    { role: "system" as const, content: NEXO_SYSTEM_PROMPT },
    { role: "system" as const, content: "Você opera somente pelas ferramentas fornecidas. Nunca invente que executou algo. Se o pedido for ambíguo, peça esclarecimento. Ações sensíveis devem retornar confirmação, sem executar. Não mencione chaves, tokens ou segredos." },
    { role: "user" as const, content: message },
  ];
  const actions: any[] = []; let last: any;
  for (let round = 0; round < 3; round += 1) {
    last = await completeWithFallback("agente", messages, undefined, agentTools as any);
    if (!last.toolCalls?.length) return { message: last.text || "Não consegui formular uma resposta. Tente novamente.", actions, provider: last.provider, switched: last.switched, fallbackReason: last.fallbackReason };
    const results = [];
    for (const call of last.toolCalls) { const result = await executeAgentTool(call.name, call.arguments); actions.push(...result.actions); results.push(`${call.name}: ${result.summary}`); }
    messages.push({ role: "assistant", content: last.text || "Ferramenta executada." });
    messages.push({ role: "user", content: `Resultados das ferramentas (já validados pelo servidor): ${results.join(" | ")}\nResponda ao dono em até 140 palavras, informando exatamente o que foi feito ou se é necessária confirmação.` });
  }
  return { message: last?.text || "A ação foi processada. Confira o log do Estúdio.", actions, provider: last?.provider, switched: last?.switched, fallbackReason: last?.fallbackReason };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    config: publicProcedure.query(() => authConfigSummary()),
    login: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(1).max(256) })).mutation(async ({ input, ctx }) => { if (!(await loginOwner(input.email, input.password, ctx.res))) throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha inválidos." }); return { success: true } as const; }),
    logout: publicProcedure.mutation(({ ctx }) => { clearSessionCookie(ctx.res); return { success: true } as const; }),
  }),
  agent: router({
    chat: adminProcedure.input(z.object({ message: z.string().trim().min(1).max(1600) })).mutation(async ({ input, ctx }) => { enforceLLMRateLimit(ctx.user.id); try { return await runAgent(input.message); } catch (error) { const message = error instanceof Error ? error.message : "Falha temporária dos provedores."; return { message: `${message} Tente de novo.`, actions: [] as any[] }; } }),
  }),
  studio: router({ persistence: adminProcedure.query(() => studioPersistenceStatus()), verifyPersistence: adminProcedure.mutation(() => verifyStudioDatabase()) }),
  llm: router({
    settings: adminProcedure.query(() => getProviderSettings()),
    usage: adminProcedure.query(() => getProviderUsage()),
    updateSettings: adminProcedure.input(z.object({ gemini: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(taskSchema), models: z.record(z.string(), z.string()).optional(), maxOutputTokens: z.record(z.string(), z.number().int().min(100).max(12_000)).optional(), thinkingBudget: z.number().int().min(0).max(8_192).optional() }), groq: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(taskSchema), models: z.record(z.string(), z.string()).optional(), maxOutputTokens: z.record(z.string(), z.number().int().min(100).max(12_000)).optional(), thinkingBudget: z.number().int().min(0).max(8_192).optional() }) })).mutation(({ input }) => updateProviderSettings(input as any)),
    testConnection: adminProcedure.input(z.object({ provider: z.enum(["gemini", "groq"]) })).mutation(({ input }) => testProvider(input.provider as LLMProviderId)),
    complete: adminProcedure.input(z.object({ task: taskSchema, messages: z.array(messageSchema).min(1).max(12), preferred: z.enum(["gemini", "groq"]).optional() }).superRefine((input, ctx) => { const total = input.messages.reduce((sum, item) => sum + item.content.length, 0); if (total > 60_000) ctx.addIssue({ code: "custom", message: "O total das mensagens excede 60.000 caracteres." }); })).mutation(({ input, ctx }) => { enforceLLMRateLimit(ctx.user.id); return completeWithFallback(input.task as LLMTask, input.messages, input.preferred); }),
  }),
});
export type AppRouter = typeof appRouter;
