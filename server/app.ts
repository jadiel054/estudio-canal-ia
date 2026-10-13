import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express, type Response } from "express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { publicPlatformScript } from "./_core/publicConfig";
import { studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readSession } from "./auth";
import { refreshRadar } from "./radar";
import { RENDER_PATHS, verifyRenderRequestSignature } from "./renderSecurity";
import { getRenderDownloadAsset, getSignedRenderInput, getSignedRenderManifest, processRenderCallback, synthesizeRenderCue } from "./renderPipeline";
import { classifyRenderFailure, isRenderOperation, type RenderErrorCode, type RenderOperation } from "./renderObservability";

function sendRenderFailure(res: Response, operation: RenderOperation, status: number, errorCode: RenderErrorCode, upstreamStatus?: number) {
  console.warn(JSON.stringify({ event: "render_operation_failed", operation, errorCode, httpStatus: status, ...(upstreamStatus ? { upstreamStatus } : {}) }));
  res.set("X-Render-Error-Code", errorCode);
  if (upstreamStatus) res.set("X-Render-Upstream-Status", String(upstreamStatus));
  return res.status(status).json({ error: errorCode, code: errorCode, ...(upstreamStatus ? { upstreamStatus } : {}) });
}

/** Registers all application API routes without starting a network listener. */
export function registerApiRoutes(app: Express) {
  app.use(express.json({ limit: "6mb", verify: (req, _res, buffer) => { if ((req as typeof req & { originalUrl?: string }).originalUrl?.startsWith("/api/render")) (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  app.use(express.urlencoded({ limit: "6mb", extended: true }));
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

  /** Endpoints privados chamados apenas pelo workflow autenticado via HMAC. */
  app.post("/api/render", async (req, res) => {
    const operation = typeof req.query.op === "string" ? req.query.op : "";
    const safeOperation: RenderOperation = isRenderOperation(operation) ? operation : "unknown";
    const signedPath = operation === "manifest" ? RENDER_PATHS.manifest : operation === "voice" ? RENDER_PATHS.voice : operation === "input" ? RENDER_PATHS.input : operation === "callback" ? RENDER_PATHS.callback : undefined;
    if (!signedPath) return sendRenderFailure(res, safeOperation, 404, "render_operation_not_found");
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
    if (!verifyRenderRequestSignature(rawBody, req.get("x-render-signature"), process.env.STUDIO_RENDER_HMAC_SECRET, { method: "POST", path: signedPath })) return sendRenderFailure(res, safeOperation, 401, "render_unauthorized");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return sendRenderFailure(res, safeOperation, 400, "invalid_json_body");
    try {
      if (operation === "manifest") {
        if (typeof req.body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.jobId)) return sendRenderFailure(res, safeOperation, 400, "invalid_job_id");
        const result = await getSignedRenderManifest(req.body.jobId);
        res.set("X-Render-Response-Signature", result.signature).type("application/json").send(result.body);
        return;
      }
      if (operation === "voice") {
        if (typeof req.body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.jobId) || !Number.isInteger(req.body.cueIndex)) return sendRenderFailure(res, safeOperation, 400, "invalid_voice_request");
        const result = await synthesizeRenderCue(req.body.jobId, req.body.cueIndex);
        res.set("X-Render-Response-Signature", result.signature).set("X-Render-Model", result.model).set("X-Render-Voice", result.voice).set("X-Render-Fallback", String(result.fallback)).type("audio/wav").send(result.audio);
        return;
      }
      if (operation === "input") {
        if (typeof req.body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.jobId) || typeof req.body.inputAssetId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.inputAssetId)) return sendRenderFailure(res, safeOperation, 400, "invalid_input_request");
        const result = await getSignedRenderInput(req.body.jobId, req.body.inputAssetId);
        res.set("X-Render-Response-Signature", result.signature).set("X-Render-SHA256", result.sha256).set("X-Render-File-Name", result.fileName).type(result.contentType).send(result.data);
        return;
      }
      const result = await processRenderCallback(req.body);
      return res.json({ ok: true, ...result });
    } catch (error) {
      const diagnostic = classifyRenderFailure(safeOperation, error);
      return sendRenderFailure(res, safeOperation, 400, diagnostic.errorCode, diagnostic.upstreamStatus);
    }
  });

  app.get("/api/render/download/:jobId", async (req, res) => {
    if (!(await readSession(req))) return res.status(401).json({ error: "unauthorized" });
    try {
      const asset = await getRenderDownloadAsset(req.params.jobId);
      const token = process.env.GITHUB_ACTIONS_TOKEN;
      if (!token) return res.status(503).json({ error: "render_download_not_configured" });
      const headers = { authorization: `Bearer ${token}`, accept: "application/octet-stream", "x-github-api-version": "2022-11-28" };
      const assetUrl = `https://api.github.com/repos/jadiel054/estudio-canal-ia/releases/assets/${asset.assetId}`;
      const apiResponse = await fetch(assetUrl, { headers, redirect: "manual", signal: AbortSignal.timeout(12_000) });
      let fileResponse = apiResponse;
      if (apiResponse.status >= 300 && apiResponse.status < 400) {
        const location = apiResponse.headers.get("location");
        if (!location) return res.status(502).json({ error: "github_asset_redirect_missing" });
        const range = req.get("range");
        fileResponse = await fetch(location, { headers: range ? { range } : {}, signal: AbortSignal.timeout(50_000) });
      }
      if (!fileResponse.ok || !fileResponse.body) return res.status(fileResponse.status === 404 ? 404 : 502).json({ error: "github_asset_unavailable" });
      res.status(fileResponse.status).set("Content-Type", "video/mp4").set("Accept-Ranges", "bytes").set("Cache-Control", "no-store, private");
      res.set("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
      for (const header of ["content-length", "content-range"]) { const value = fileResponse.headers.get(header); if (value) res.set(header, value); }
      await pipeline(Readable.fromWeb(fileResponse.body as any), res);
    } catch (error) {
      if (res.headersSent) return res.destroy(error instanceof Error ? error : undefined);
      const message = error instanceof Error ? error.message.slice(0, 250) : "Falha ao abrir o MP4.";
      return res.status(404).json({ error: "render_file_unavailable", message });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
}
