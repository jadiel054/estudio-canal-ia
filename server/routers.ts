import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { NEXO_SYSTEM_PROMPT } from "./agent/systemPrompt";
import { agentTools, executeAgentTool } from "./agent/tools";
import { appendStudioAudit, consumeRateLimit, resolveAgentConfirmation, studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { completeWithFallback, getProviderSettings, getProviderUsage, testProvider, updateProviderSettings, type LLMMessage, type LLMProviderId, type LLMTask } from "./llmProviders";
import { authConfigSummary, changeOwnerPassword, clearSessionCookie, loginOwner } from "./auth";
async function enforceLLMRateLimit(userId: string) { if (!(await consumeRateLimit(`llm:${userId}`, 20))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite de 20 chamadas LLM por minuto atingido. Tente novamente em instantes." }); }
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
    login: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(1).max(256) })).mutation(async ({ input, ctx }) => { if (!(await loginOwner(input.email, input.password, ctx.req, ctx.res))) throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha inválidos." }); return { success: true } as const; }),
    changePassword: adminProcedure.input(z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) })).mutation(async ({ input }) => { if (!(await changeOwnerPassword(input.currentPassword, input.newPassword))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha atual inválida." }); return { success: true } as const; }),
    logout: publicProcedure.mutation(({ ctx }) => { clearSessionCookie(ctx.res); return { success: true } as const; }),
  }),
  agent: router({
    chat: adminProcedure.input(z.object({ message: z.string().trim().min(1).max(1600) })).mutation(async ({ input, ctx }) => { await enforceLLMRateLimit(ctx.user.id); try { return await runAgent(input.message); } catch (error) { const message = error instanceof Error ? error.message : "Falha temporária dos provedores."; return { message: `${message} Tente de novo.`, actions: [] as any[] }; } }),
    confirm: adminProcedure.input(z.object({ confirmationId: z.string().uuid(), approved: z.boolean() })).mutation(async ({ input, ctx }) => { const resolved = await resolveAgentConfirmation(input.confirmationId, input.approved); if (!resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmação expirada ou já resolvida." }); if (!input.approved) { await appendStudioAudit({ actor: "Você", action: "Ação sensível cancelada", target: resolved.action, details: { confirmationId: input.confirmationId } }); return { approved: false, actions: [] as any[], message: "Ação cancelada. Nada foi executado." }; } if (resolved.action !== "publicacao_automatica") { await appendStudioAudit({ actor: "Você", action: "Ação sensível confirmada", target: resolved.action, details: { confirmationId: input.confirmationId } }); return { approved: true, actions: [] as any[], message: "Confirmação registrada. A ação ficará disponível na próxima etapa segura." }; } await appendStudioAudit({ actor: "Você", action: "Publicação automática confirmada", target: "publicacao", details: { confirmationId: input.confirmationId } }); return { approved: true, actions: [{ type: "setAutomation", key: "publicacao", value: "Automática" }], message: "Publicação automática ativada após sua confirmação explícita." }; }),
  }),
  studio: router({ persistence: adminProcedure.query(() => studioPersistenceStatus()), verifyPersistence: adminProcedure.mutation(() => verifyStudioDatabase()) }),
  llm: router({
    settings: adminProcedure.query(() => getProviderSettings()),
    usage: adminProcedure.query(() => getProviderUsage()),
    updateSettings: adminProcedure.input(z.object({ gemini: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(taskSchema), models: z.record(z.string(), z.string()).optional(), maxOutputTokens: z.record(z.string(), z.number().int().min(100).max(12_000)).optional(), thinkingBudget: z.number().int().min(0).max(8_192).optional() }), groq: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(taskSchema), models: z.record(z.string(), z.string()).optional(), maxOutputTokens: z.record(z.string(), z.number().int().min(100).max(12_000)).optional(), thinkingBudget: z.number().int().min(0).max(8_192).optional() }) })).mutation(({ input }) => updateProviderSettings(input as any)),
    testConnection: adminProcedure.input(z.object({ provider: z.enum(["gemini", "groq"]) })).mutation(({ input }) => testProvider(input.provider as LLMProviderId)),
    complete: adminProcedure.input(z.object({ task: taskSchema, messages: z.array(messageSchema).min(1).max(12), preferred: z.enum(["gemini", "groq"]).optional() }).superRefine((input, ctx) => { const total = input.messages.reduce((sum, item) => sum + item.content.length, 0); if (total > 60_000) ctx.addIssue({ code: "custom", message: "O total das mensagens excede 60.000 caracteres." }); })).mutation(async ({ input, ctx }) => { await enforceLLMRateLimit(ctx.user.id); return completeWithFallback(input.task as LLMTask, input.messages, input.preferred); }),
  }),
});
export type AppRouter = typeof appRouter;
