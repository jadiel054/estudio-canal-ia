import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { NEXO_SYSTEM_PROMPT } from "./agent/systemPrompt";
import { agentTools, executeAgentTool } from "./agent/tools";
import { appendStudioAudit, consumeRateLimit, getStudioState, resolveAgentConfirmation, saveStudioNonEditorialState, saveStudioState, studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { completeWithFallback, getProviderSettings, getProviderUsage, testProvider, updateProviderSettings, type LLMMessage, type LLMProviderId, type LLMTask } from "./llmProviders";
import { authConfigSummary, changeOwnerPassword, clearSessionCookie, invalidateAllSessions, loginOwner } from "./auth";
import { executeEditorialCommand, type EditorialCommand } from "./editorial";
async function enforceLLMRateLimit(userId: string) { if (!(await consumeRateLimit(`llm:${userId}`, 20))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite de 20 chamadas LLM por minuto atingido. Tente novamente em instantes." }); }
const taskSchema = z.enum(["roteiro", "qa", "agente", "leve"]);
const messageSchema = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(20_000) });
const editorialCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("createIdea"), title: z.string().trim().min(1).max(240), format: z.enum(["Longo", "Short", "Live"]), origin: z.enum(["Radar", "Projeto", "Agente"]).optional(), trendId: z.string().max(120).optional(), angle: z.string().max(1000).optional() }),
  z.object({ operation: z.literal("updateScript"), scriptId: z.string().min(1).max(120), content: z.string().min(1).max(100_000) }),
  z.object({ operation: z.literal("generateScript"), ideaId: z.string().min(1).max(120), content: z.string().min(1).max(100_000) }),
  z.object({ operation: z.literal("approveScript"), ideaId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("requestScriptChanges"), ideaId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("startRender"), ideaId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("approveVideo"), videoId: z.string().min(1).max(120), overrideQa: z.boolean() }),
  z.object({ operation: z.literal("requestVideoChanges"), videoId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("scheduleVideo"), videoId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("retryVideo"), videoId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("addAsset"), asset: z.object({ scriptId: z.string().min(1).max(120), type: z.string().min(1).max(40), label: z.string().min(1).max(240), license: z.string().min(1).max(240), status: z.string().min(1).max(40) }) }),
]);

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
    logoutAll: adminProcedure.mutation(async ({ ctx }) => { await invalidateAllSessions(); clearSessionCookie(ctx.res); return { success: true } as const; }),
    logout: publicProcedure.mutation(({ ctx }) => { clearSessionCookie(ctx.res); return { success: true } as const; }),
  }),
  agent: router({
    chat: adminProcedure.input(z.object({ message: z.string().trim().min(1).max(1600) })).mutation(async ({ input, ctx }) => { await enforceLLMRateLimit(ctx.user.id); try { return await runAgent(input.message); } catch (error) { const message = error instanceof Error ? error.message : "Falha temporária dos provedores."; return { message: `${message} Tente de novo.`, actions: [] as any[] }; } }),
    confirm: adminProcedure.input(z.object({ confirmationId: z.string().uuid(), approved: z.boolean() })).mutation(async ({ input }) => { const resolved = await resolveAgentConfirmation(input.confirmationId, input.approved); if (!resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmação expirada ou já resolvida." }); if (!input.approved) { await appendStudioAudit({ actor: "Você", action: "Ação sensível cancelada", target: resolved.action, details: { confirmationId: input.confirmationId } }); return { approved: false, message: "Ação cancelada. Nada foi executado." }; } if (resolved.action !== "publicacao_automatica") { await appendStudioAudit({ actor: "Você", action: "Ação sensível confirmada", target: resolved.action, details: { confirmationId: input.confirmationId } }); return { approved: true, message: "Confirmação registrada." }; } const state = await getStudioState() as any; if (!state) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Importe o estado deste aparelho para o Neon antes de confirmar." }); state.settings = { ...state.settings, automation: { ...state.settings.automation, publicacao: "Automática" } }; state.audit = [{ id: randomUUID(), actor: "Você", action: "Publicação automática confirmada", target: "publicacao", at: new Date().toISOString(), detail: "Alteração persistida no Neon" }, ...(state.audit ?? [])].slice(0, 500); await saveStudioState(state, { allowPublicationAutomation: true }); await appendStudioAudit({ actor: "Você", action: "Publicação automática confirmada", target: "publicacao", details: { confirmationId: input.confirmationId } }); return { approved: true, message: "Publicação automática ativada após sua confirmação explícita." }; }),
  }),
  studio: router({ persistence: adminProcedure.query(() => studioPersistenceStatus()), verifyPersistence: adminProcedure.mutation(() => verifyStudioDatabase()), state: adminProcedure.query(() => getStudioState()), command: adminProcedure.input(editorialCommandSchema).mutation(async ({ input }) => { try { return await executeEditorialCommand(input as EditorialCommand); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Comando editorial recusado pelo servidor." }); } }), saveState: adminProcedure.input(z.unknown()).mutation(({ input }) => saveStudioNonEditorialState(input)), importState: adminProcedure.input(z.unknown()).mutation(({ input }) => saveStudioState(input)), publish: adminProcedure.input(z.object({ videoId: z.string() })).mutation(async ({ input }) => { const state = await getStudioState() as any; if (!state) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Estado não importado para o Neon." }); if (state.settings?.automation?.publicacao !== "Manual") throw new TRPCError({ code: "FORBIDDEN", message: "Publicação bloqueada: revisão humana obrigatória." }); const video = state.videos?.find((item: any) => item.id === input.videoId); if (!video || !["aprovado_para_agenda", "agendado"].includes(video.stage)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Vídeo não aprovado para publicação." }); await appendStudioAudit({ actor: "Você", action: "Publicação autorizada após verificação Neon", target: video.title, details: { videoId: input.videoId } }); return { allowed: true, message: "Publicação autorizada após verificação dos portões no Neon." }; }) }),
  llm: router({
    settings: adminProcedure.query(() => getProviderSettings()),
    usage: adminProcedure.query(() => getProviderUsage()),
    updateSettings: adminProcedure.input(z.object({ gemini: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(taskSchema), models: z.record(z.string(), z.string()).optional(), maxOutputTokens: z.record(z.string(), z.number().int().min(100).max(12_000)).optional(), thinkingBudget: z.number().int().min(0).max(8_192).optional() }), groq: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(taskSchema), models: z.record(z.string(), z.string()).optional(), maxOutputTokens: z.record(z.string(), z.number().int().min(100).max(12_000)).optional(), thinkingBudget: z.number().int().min(0).max(8_192).optional() }) })).mutation(({ input }) => updateProviderSettings(input as any)),
    testConnection: adminProcedure.input(z.object({ provider: z.enum(["gemini", "groq"]) })).mutation(({ input }) => testProvider(input.provider as LLMProviderId)),
    complete: adminProcedure.input(z.object({ task: taskSchema, messages: z.array(messageSchema).min(1).max(12), preferred: z.enum(["gemini", "groq"]).optional() }).superRefine((input, ctx) => { const total = input.messages.reduce((sum, item) => sum + item.content.length, 0); if (total > 60_000) ctx.addIssue({ code: "custom", message: "O total das mensagens excede 60.000 caracteres." }); })).mutation(async ({ input, ctx }) => { await enforceLLMRateLimit(ctx.user.id); return completeWithFallback(input.task as LLMTask, input.messages, input.preferred); }),
  }),
});
export type AppRouter = typeof appRouter;
