import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { NEXO_SYSTEM_PROMPT } from "./agent/systemPrompt";
import { studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { completeWithFallback, getProviderSettings, getProviderUsage, testProvider, updateProviderSettings, type LLMProviderId, type LLMTask } from "./llmProviders";

type AgentAction =
  | { type: "setAutomation"; key: "radar" | "roteiro" | "producao" | "publicacao"; value: "Automática" | "Manual" }
  | { type: "createIdea"; title: string; format: "Longo" | "Short" | "Live"; origin: "Agente" }
  | { type: "connectPlatform"; platform: "youtube" | "tiktok" }
  | { type: "requestConfirmation"; subject: string; description: string };

function controlledActions(message: string): AgentAction[] {
  const text = message.toLowerCase();
  if (text.includes("publicação automática") || text.includes("publicar automático")) {
    return [{ type: "requestConfirmation", subject: "Publicação automática", description: "Ativar publicação automática reduziria o Portão 2 e pode enviar conteúdo sem revisão final." }];
  }
  if ((text.includes("vídeo") || text.includes("produção") || text.includes("render")) && text.includes("manual")) {
    return [{ type: "setAutomation", key: "producao", value: "Manual" }];
  }
  if (text.includes("tiktok") && (text.includes("conect") || text.includes("ativ"))) {
    return [{ type: "connectPlatform", platform: "tiktok" }];
  }
  if (text.includes("youtube") && text.includes("conect")) {
    return [{ type: "connectPlatform", platform: "youtube" }];
  }
  if (text.includes("pauta") || text.includes("ideia")) {
    const title = message.replace(/crie|criar|uma|pauta|ideia|sobre/gi, "").trim() || "Nova pauta técnica com demonstração real";
    return [{ type: "createIdea", title, format: "Longo", origin: "Agente" }];
  }
  return [];
}

function fallbackReply(actions: AgentAction[]) {
  const action = actions[0];
  if (!action) return "O melhor próximo passo é revisar o roteiro MCP ou aprovar a prévia do Zarith. Posso criar uma pauta, consultar a fila ou ajustar uma etapa permitida.";
  if (action.type === "setAutomation") return `A etapa de ${action.key} foi preparada para o modo ${action.value}. A alteração será registrada no log de auditoria.`;
  if (action.type === "connectPlatform") return `A conexão com ${action.platform === "youtube" ? "YouTube" : "TikTok"} foi preparada para receber credenciais OAuth no cofre. Nenhuma publicação foi enviada.`;
  if (action.type === "createIdea") return `Criei a pauta “${action.title}” em Pesquisa. Ela continuará exigindo roteiro original e demonstração real.`;
  return `Isso exige sua confirmação porque ${action.description.toLowerCase()}`;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  agent: router({
    chat: protectedProcedure
      .input(z.object({ message: z.string().trim().min(1).max(1600) }))
      .mutation(async ({ input }) => {
        const actions = controlledActions(input.message);
        const safeFallback = fallbackReply(actions);
        try {
          const response = await completeWithFallback("agente", [
            { role: "system", content: NEXO_SYSTEM_PROMPT },
            { role: "system", content: "Responda em no máximo 110 palavras. Não mencione segredos nem prometa execução externa. As ações permitidas já foram validadas pelo sistema." },
            { role: "user", content: input.message },
          ]);
          return { message: response.text, actions, provider: response.provider, switched: response.switched, fallbackReason: response.fallbackReason };
        } catch (error) {
          console.warn("[Nexo] LLM indisponível; usando resposta operacional segura", error instanceof Error ? error.message : error);
          const providerError = error instanceof Error && (/Todos os provedores|Nenhum provedor/.test(error.message))
            ? `${error.message} Tente novamente.`
            : safeFallback;
          return { message: providerError, actions };
        }
      }),
  }),
  studio: router({
    persistence: protectedProcedure.query(() => studioPersistenceStatus()),
    verifyPersistence: protectedProcedure.mutation(() => verifyStudioDatabase()),
  }),
  llm: router({
    settings: protectedProcedure.query(() => getProviderSettings()),
    usage: protectedProcedure.query(() => getProviderUsage()),
    updateSettings: protectedProcedure
      .input(z.object({
        gemini: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(z.enum(["roteiro", "qa", "agente", "leve"])) }),
        groq: z.object({ enabled: z.boolean(), priority: z.number().int().min(1).max(2), tasks: z.array(z.enum(["roteiro", "qa", "agente", "leve"])) }),
      }))
      .mutation(({ input }) => updateProviderSettings(input)),
    testConnection: protectedProcedure
      .input(z.object({ provider: z.enum(["gemini", "groq"]) }))
      .mutation(({ input }) => testProvider(input.provider as LLMProviderId)),
    complete: protectedProcedure
      .input(z.object({ task: z.enum(["roteiro", "qa", "agente", "leve"]), messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(20_000) })), preferred: z.enum(["gemini", "groq"]).optional() }))
      .mutation(({ input }) => completeWithFallback(input.task as LLMTask, input.messages, input.preferred)),
  }),
});

export type AppRouter = typeof appRouter;
