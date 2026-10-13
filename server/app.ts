import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express } from "express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { publicPlatformScript } from "./_core/publicConfig";
import { studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { timingSafeEqual } from "node:crypto";
import { refreshRadar } from "./radar";

/** Registers all application API routes without starting a network listener. */
export function registerApiRoutes(app: Express) {
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Nenhuma resposta de API pode ser armazenada por browser, CDN ou service worker.
  // Isso inclui sessão, configuração, estado do Neon e respostas autenticadas do tRPC.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store, private");
    next();
  });

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

  /** Endpoint exclusivo do Vercel Cron. Só aceita o bearer CRON_SECRET. */
  app.get("/api/cron/radar", async (req, res) => {
    const configured = process.env.CRON_SECRET;
    if (!configured) return res.status(503).json({ error: "cron_not_configured" });
    const supplied = req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const expectedBytes = Buffer.from(configured);
    const suppliedBytes = Buffer.from(supplied);
    const authorized = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
    if (!authorized) return res.status(401).json({ error: "unauthorized" });
    try {
      const result = await refreshRadar("Sistema", "cron");
      return res.json({ ok: true, total: result.total, classifiedByLLM: result.classifiedByLLM, collectedAt: result.collectedAt, sources: result.sources });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "Radar unavailable";
      return res.status(502).json({ error: "radar_refresh_failed", message });
    }
  });

  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
}
