import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canPublishVideo } from "@shared/workflowPolicy";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { runNexo, redactNexoText } from "./agent/runtime";
import { appendStudioAudit, consumeRateLimit, getStudioState, hasApprovedAutomaticPublication, resolveAgentConfirmation, saveStudioNonEditorialState, saveStudioState, StateConflictError, studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { completeWithFallback, getProviderSettings, getProviderUsage, testProvider, updateProviderSettings, THINKING_LEVELS, type LLMProviderId, type LLMTask } from "./llmProviders";
import { authConfigSummary, changeOwnerPassword, clearSessionCookie, invalidateAllSessions, loginOwner } from "./auth";
import { executeEditorialCommand, type EditorialCommand } from "./editorial";
import { parseStudioState, StateTooLargeError } from "./studioStateSchema";
import { getRadarState, refreshRadar } from "./radar";
import { generateScriptForIdea, reviewScriptForCurrentDraft } from "./scriptPipeline";
import { generateSpeechCached, getTtsSettings, testTtsConnection, TTS_NARRATION_STYLE, ttsSettingsSchema, updateTtsSettings } from "./ttsProvider";
import { estimateRenderTtsCalls, renderIntegrationStatus, requestRenderAssetCleanup, startRenderPipeline, testGitHubActionsConnection, uploadRenderInput } from "./renderPipeline";
import { getTtsUsageSummary } from "./ttsUsage";

async function enforceLLMRateLimit(userId: string) { if (!(await consumeRateLimit(`llm:${userId}`, 20))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite de 20 chamadas LLM por minuto atingido. Tente novamente em instantes." }); }
const taskSchema = z.enum(["roteiro", "qa", "agente", "leve"]);
const messageSchema = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(20_000) });
const thinkingLevelSchema = z.enum(THINKING_LEVELS as [string, ...string[]]);
const providerPatchSchema = z.object({
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(2),
  tasks: z.array(taskSchema),
  models: z.record(z.string(), z.string().max(120)).optional(),
  maxOutputTokens: z.record(z.string(), z.number().int().min(100).max(12_000)).optional(),
  thinkingLevel: z.record(z.string(), thinkingLevelSchema).optional(),
});
const editorialCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("createIdea"), title: z.string().trim().min(1).max(240), format: z.enum(["Longo", "Short", "Live"]), origin: z.enum(["Radar", "Projeto", "Agente"]).optional(), trendId: z.string().max(120).optional(), angle: z.string().max(1000).optional(), sourceNotes: z.string().max(5000).optional(), captureUrls: z.array(z.string().url().max(900)).max(10).optional() }),
  z.object({ operation: z.literal("updateScript"), scriptId: z.string().min(1).max(120), content: z.string().min(1).max(100_000) }),
  z.object({ operation: z.literal("approveScript"), ideaId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("requestScriptChanges"), ideaId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("startRender"), ideaId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("approveVideo"), videoId: z.string().min(1).max(120), overrideQa: z.boolean() }),
  z.object({ operation: z.literal("requestVideoChanges"), videoId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("rejectVideo"), videoId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("scheduleVideo"), videoId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("retryVideo"), videoId: z.string().min(1).max(120) }),
  z.object({ operation: z.literal("setDemoMode"), enabled: z.boolean() }),
  z.object({ operation: z.literal("clearExampleData") }),
  z.object({ operation: z.literal("addAsset"), asset: z.object({ scriptId: z.string().min(1).max(120), type: z.string().min(1).max(40), label: z.string().min(1).max(240), license: z.string().min(1).max(240), status: z.string().min(1).max(40) }) }),
]);

/** Converte falhas conhecidas do servidor em respostas tRPC claras. */
function toTrpcError(error: unknown): TRPCError {
  if (error instanceof StateConflictError) return new TRPCError({ code: "CONFLICT", message: error.message });
  if (error instanceof StateTooLargeError) return new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: error.message });
  return new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Comando editorial recusado pelo servidor." });
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
    chat: adminProcedure.input(z.object({
      message: z.string().trim().min(1).max(1600),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1200) })).max(10).optional(),
    })).mutation(async ({ input, ctx }) => {
      await enforceLLMRateLimit(ctx.user.id);
      try { return await runNexo(input.message, input.history ?? []); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Falha temporária dos provedores.";
        return { message: `${redactNexoText(message, 300)} Tente de novo.`, actions: [] as any[] };
      }
    }),
    confirm: adminProcedure.input(z.object({ confirmationId: z.string().uuid(), approved: z.boolean() })).mutation(async ({ input }) => { const resolved = await resolveAgentConfirmation(input.confirmationId, input.approved); if (!resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmação expirada ou já resolvida." }); if (!input.approved) { await appendStudioAudit({ actor: "Você", action: "Ação sensível cancelada", target: resolved.action, details: { confirmationId: input.confirmationId } }); return { approved: false, message: "Ação cancelada. Nada foi executado." }; } if (resolved.action !== "publicacao_automatica") { await appendStudioAudit({ actor: "Você", action: "Ação sensível confirmada", target: resolved.action, details: { confirmationId: input.confirmationId } }); return { approved: true, message: "Confirmação registrada." }; } const state = await getStudioState() as any; if (!state) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Importe o estado deste aparelho para o Neon antes de confirmar." }); state.settings = { ...state.settings, automation: { ...state.settings.automation, publicacao: "Automática" } }; state.audit = [{ id: randomUUID(), actor: "Você", action: "Publicação automática confirmada", target: "publicacao", at: new Date().toISOString(), detail: "Alteração persistida no Neon" }, ...(state.audit ?? [])].slice(0, 500); await saveStudioState(state, { allowPublicationAutomation: true }); await appendStudioAudit({ actor: "Você", action: "Publicação automática confirmada", target: "publicacao", details: { confirmationId: input.confirmationId } }); return { approved: true, message: "Publicação automática ativada após sua confirmação explícita." }; }),
  }),
  studio: router({
    persistence: adminProcedure.query(() => studioPersistenceStatus()),
    verifyPersistence: adminProcedure.mutation(() => verifyStudioDatabase()),
    state: adminProcedure.query(() => getStudioState()),
    renderIntegration: adminProcedure.query(() => renderIntegrationStatus()),
    testGitHubActionsConnection: adminProcedure.mutation(async ({ ctx }) => {
      if (!(await consumeRateLimit(`github-actions-connection:${ctx.user.id}`, 1))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "O teste do GitHub Actions pode ser executado uma vez por minuto." });
      return testGitHubActionsConnection();
    }),
    ttsUsage: adminProcedure.query(() => getTtsUsageSummary()),
    setRenderVoiceMode: adminProcedure.input(z.object({ voiceMode: z.enum(["TTS", "Música + texto"]) })).mutation(async ({ input }) => {
      const state = await getStudioState() as any;
      if (!state) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Importe primeiro o estado do estúdio para o Neon." });
      const now = new Date().toISOString();
      try {
        await saveStudioNonEditorialState({ ...state, settings: { ...state.settings, voiceMode: input.voiceMode }, audit: [{ id: randomUUID(), actor: "Você", action: "Modo de áudio do render alterado", target: input.voiceMode, at: now, detail: "Persistido antes do próximo job" }, ...(state.audit ?? [])].slice(0, 500) });
      } catch (error) { throw toTrpcError(error); }
      return { voiceMode: input.voiceMode } as const;
    }),
    renderTtsEstimate: adminProcedure.input(z.object({ ideaId: z.string().min(1).max(120) })).query(async ({ input }) => {
      try { return await estimateRenderTtsCalls(input.ideaId); }
      catch (error) { throw toTrpcError(error); }
    }),
    cleanupRenderAsset: adminProcedure.input(z.object({ jobId: z.string().uuid() })).mutation(async ({ input }) => {
      try { return await requestRenderAssetCleanup(input.jobId); }
      catch (error) { throw toTrpcError(error); }
    }),
    uploadRenderInput: adminProcedure.input(z.object({ ideaId: z.string().min(1).max(120), fileName: z.string().min(1).max(120), contentType: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(1).max(2_800_000) })).mutation(async ({ input, ctx }) => {
      try { return await uploadRenderInput(input, ctx.user.id); }
      catch (error) { throw toTrpcError(error); }
    }),
    radar: adminProcedure.query(async () => getRadarState()),
    refreshRadar: adminProcedure.mutation(async ({ ctx }) => {
      if (!(await consumeRateLimit(`radar-refresh:${ctx.user.id}`, 1))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "O Radar pode ser atualizado uma vez por minuto. Aguarde e tente novamente." });
      try { return await refreshRadar("Você", "manual"); }
      catch (error) { throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Falha ao atualizar as fontes do Radar. Tente novamente." }); }
    }),
    generateScript: adminProcedure.input(z.object({ ideaId: z.string().min(1).max(120) })).mutation(async ({ input, ctx }) => {
      await enforceLLMRateLimit(ctx.user.id);
      try { return await generateScriptForIdea(input.ideaId); }
      catch (error) { throw toTrpcError(error); }
    }),
    reviewScript: adminProcedure.input(z.object({ scriptId: z.string().min(1).max(120), content: z.string().trim().min(1).max(100_000) })).mutation(async ({ input, ctx }) => {
      await enforceLLMRateLimit(ctx.user.id);
      try { return await reviewScriptForCurrentDraft(input.scriptId, input.content); }
      catch (error) { throw toTrpcError(error); }
    }),
    command: adminProcedure.input(editorialCommandSchema).mutation(async ({ input }) => {
      try {
        if (input.operation === "startRender") return await startRenderPipeline(input.ideaId);
        // O ator vem do contexto autenticado, não de heurística sobre o texto da ação.
        return await executeEditorialCommand(input as EditorialCommand, { actor: "Você" });
      } catch (error) {
        throw toTrpcError(error);
      }
    }),
    saveState: adminProcedure.input(z.unknown()).mutation(async ({ input }) => {
      try {
        const validated = parseStudioState(input);
        return await saveStudioNonEditorialState(validated);
      } catch (error) {
        throw toTrpcError(error);
      }
    }),
    importState: adminProcedure.input(z.unknown()).mutation(async ({ input }) => {
      try {
        const validated = parseStudioState(input);
        const saved = await saveStudioState(validated);
        await appendStudioAudit({ actor: "Você", action: "Estado do aparelho importado para o Neon", target: "studio_state", details: { version: saved.version } });
        return saved;
      } catch (error) {
        throw toTrpcError(error);
      }
    }),
    /**
     * Autorização de publicação, decidida no servidor a partir do Neon.
     *
     * Regra única (`canPublishVideo` em `@shared/workflowPolicy`):
     * 1. vídeo aprovado no Portão 2 e roteiro aprovado no Portão 1;
     * 2. vídeo simulado só passa em modo demonstração explícito;
     * 3. com a etapa `publicacao` em "Automática", é exigida uma confirmação
     *    explícita do dono registrada no Neon — sem ela, o estúdio libera
     *    apenas a publicação manual.
     */
    publish: adminProcedure.input(z.object({ videoId: z.string().min(1).max(120) })).mutation(async ({ input }) => {
      const state = await getStudioState() as any;
      if (!state) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Estado não importado para o Neon." });
      const video = state.videos?.find((item: any) => item.id === input.videoId);
      if (!video) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Vídeo não encontrado no estado do Neon." });
      const script = state.scripts?.find((item: any) => item.id === video.scriptId);
      const automation = state.settings?.automation?.publicacao === "Automática" ? "Automática" : "Manual";
      const automaticPublicationConfirmed = automation === "Automática" ? await hasApprovedAutomaticPublication() : false;
      const guard = canPublishVideo({ videoStage: video.stage, scriptStatus: script?.status ?? "Rascunho", simulated: Boolean(video.simulated), demoMode: state.settings?.demoMode === true, automation, automaticPublicationConfirmed });
      if (!guard.allowed) throw new TRPCError({ code: "FORBIDDEN", message: guard.reason });
      await appendStudioAudit({ actor: "Você", action: "Publicação autorizada após verificação Neon", target: video.title, details: { videoId: input.videoId, automation, simulated: Boolean(video.simulated), demoMode: state.settings?.demoMode === true } });
      return { allowed: true, automation, message: automation === "Automática" ? "Publicação automática autorizada: vídeo aprovado no Portão 2 e confirmação explícita registrada no Neon." : "Publicação manual autorizada após verificação dos portões no Neon. Exporte o vídeo e publique você mesmo." };
    }),
  }),
  llm: router({
    settings: adminProcedure.query(() => getProviderSettings()),
    usage: adminProcedure.query(() => getProviderUsage()),
    updateSettings: adminProcedure.input(z.object({ gemini: providerPatchSchema, groq: providerPatchSchema })).mutation(({ input }) => updateProviderSettings(input as any)),
    testConnection: adminProcedure.input(z.object({ provider: z.enum(["gemini", "groq"]) })).mutation(({ input }) => testProvider(input.provider as LLMProviderId)),
    complete: adminProcedure.input(z.object({ task: taskSchema, messages: z.array(messageSchema).min(1).max(12), preferred: z.enum(["gemini", "groq"]).optional() }).superRefine((input, ctx) => { const total = input.messages.reduce((sum, item) => sum + item.content.length, 0); if (total > 60_000) ctx.addIssue({ code: "custom", message: "O total das mensagens excede 60.000 caracteres." }); })).mutation(async ({ input, ctx }) => { await enforceLLMRateLimit(ctx.user.id); return completeWithFallback(input.task as LLMTask, input.messages, input.preferred); }),
  }),
  tts: router({
    settings: adminProcedure.query(async () => ({ ...await getTtsSettings(), configured: Boolean(process.env.STUDIO_LLM_GEMINI_KEY), dataPolicy: "O nível gratuito pode usar entradas e saídas para melhoria de produtos e revisão humana; não envie dados sensíveis." })),
    updateSettings: adminProcedure.input(ttsSettingsSchema).mutation(async ({ input }) => updateTtsSettings(input)),
    testConnection: adminProcedure.mutation(async ({ ctx }) => {
      if (!(await consumeRateLimit(`tts-connection:${ctx.user.id}`, 1))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "O teste de conexão TTS pode ser executado uma vez por minuto." });
      return testTtsConnection(await getTtsSettings());
    }),
    test: adminProcedure.mutation(async ({ ctx }) => {
      if (!(await consumeRateLimit(`tts-test:${ctx.user.id}`, 1))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "A amostra de voz pode ser gerada uma vez por minuto." });
      const settings = await getTtsSettings();
      const result = await generateSpeechCached("Olá! Este é um teste de voz em português brasileiro para o Estúdio de Canal IA.", settings, TTS_NARRATION_STYLE, "connection_test");
      return { audioBase64: result.audio.toString("base64"), contentType: result.contentType, model: result.model, voice: result.voice, fallback: result.fallback, bytes: result.audio.length };
    }),
  }),
});
export type AppRouter = typeof appRouter;
