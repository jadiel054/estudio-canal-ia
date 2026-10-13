import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express } from "express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { registerOAuthRoutes } from "./_core/oauth";
import { publicPlatformScript } from "./_core/publicConfig";
import { studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";

/** Registers all application API routes without starting a network listener. */
export function registerApiRoutes(app: Express) {
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  /**
   * Health check com dois níveis:
   * - `app`: a função serverless carregou e está respondendo.
   * - `database`: o Neon respondeu (ou está "não configurado", sem derrubar o app).
   * Sempre responde 200 para que a plataforma não marque a função como quebrada.
   */
  app.get("/api/health", async (_req, res) => {
    let database: Awaited<ReturnType<typeof verifyStudioDatabase>>;
    try {
      database = await verifyStudioDatabase();
    } catch (error) {
      console.warn("[Estúdio] Health: verificação do Neon falhou:", error instanceof Error ? error.message : error);
      database = { reachable: false, ...studioPersistenceStatus() };
    }

    res.json({
      status: "ok",
      app: {
        ok: true,
        environment: process.env.NODE_ENV ?? "unknown",
        region: process.env.VERCEL_REGION ?? null,
      },
      database,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });

  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
}