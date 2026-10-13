import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { NEXO_SYSTEM_PROMPT, agentToolDefinitions } from "./agent/systemPrompt";
import { studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";

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
          const response = await invokeLLM({
            model: "gpt-5-mini",
            messages: [
              { role: "system", content: NEXO_SYSTEM_PROMPT },
              { role: "system", content: "Responda em no máximo 110 palavras. Não mencione segredos nem prometa execução externa. As ações permitidas já foram validadas pelo sistema." },
              { role: "user", content: input.message },
            ],
            tools: agentToolDefinitions,
            toolChoice: "auto",
          });
          const content = response.choices[0]?.message.content;
          const message = typeof content === "string" && content.trim() ? content.trim() : safeFallback;
          return { message, actions };
        } catch (error) {
          console.warn("[Nexo] LLM indisponível; usando resposta operacional segura", error instanceof Error ? error.message : error);
          return { message: safeFallback, actions };
        }
      }),
  }),
  studio: router({
    persistence: protectedProcedure.query(() => studioPersistenceStatus()),
    verifyPersistence: protectedProcedure.mutation(() => verifyStudioDatabase()),
  }),
});

export type AppRouter = typeof appRouter;
