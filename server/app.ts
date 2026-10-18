import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express, type Response } from "express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { publicPlatformScript } from "./_core/publicConfig";
import { studioPersistenceStatus, verifyStudioDatabase } from "./studioRepository";
import { timingSafeEqual } from "node:crypto";
import { refreshRadar } from "./radar";
import { RENDER_PATHS, verifyRenderRequestSignature } from "./renderSecurity";
import { getSignedRenderImage, getSignedRenderInput, getSignedRenderManifest, processRenderCallback, synthesizeRenderChunk } from "./renderPipeline";
import { callbackStageDiagnostic, classifyRenderFailure, isRenderCallbackStageCode, isRenderOperation, renderFailureLogRecord, type RenderErrorCode, type RenderOperation } from "./renderObservability";
import { registerRenderDeliveryRoutes } from "./renderDelivery";
import { handleYouTubeOAuthCallback, startYouTubeOAuth, YouTubeOAuthError } from "./youtubeOAuth";
import { readSession } from "./auth";
import { processVideoGenQueue, pollRunningVideoGenJobs } from "./videoGenWorker";

function sendRenderFailure(res: Response, operation: RenderOperation, status: number, errorCode: RenderErrorCode, upstreamStatus?: number, detail?: ReturnType<typeof classifyRenderFailure>) {
  const safeDetail = {
    ...(detail?.quotaScope ? { quotaScope: detail.quotaScope } : {}),
    ...(detail?.quotaValue !== undefined ? { quotaValue: detail.quotaValue } : {}),
    ...(detail?.quotaMetric ? { quotaMetric: detail.quotaMetric } : {}),
    ...(detail?.quotaId ? { quotaId: detail.quotaId } : {}),
    ...(detail?.retryAfterMs !== undefined ? { retryAfterMs: detail.retryAfterMs } : {}),
    ...(detail?.providerModel ? { providerModel: detail.providerModel } : {}),
  };
  const safeStageCode = isRenderCallbackStageCode(detail?.stageCode) ? detail.stageCode : undefined;
  console.warn(JSON.stringify(renderFailureLogRecord({ ...(detail ?? {}), operation, errorCode, ...(upstreamStatus ? { upstreamStatus } : {}) }, status)));
  res.set("X-Render-Error-Code", errorCode);
  if (safeStageCode) res.set("X-Render-Stage-Code", safeStageCode);
  if (upstreamStatus) res.set("X-Render-Upstream-Status", String(upstreamStatus));
  if (safeDetail.quotaScope) res.set("X-Render-Quota-Scope", safeDetail.quotaScope);
  if (safeDetail.quotaValue !== undefined) res.set("X-Render-Quota-Value", String(safeDetail.quotaValue));
  if (safeDetail.quotaMetric) res.set("X-Render-Quota-Metric", safeDetail.quotaMetric);
  if (safeDetail.quotaId) res.set("X-Render-Quota-Id", safeDetail.quotaId);
  if (safeDetail.retryAfterMs !== undefined) res.set("X-Render-Retry-After-Ms", String(safeDetail.retryAfterMs));
  if (safeDetail.providerModel) res.set("X-Render-TTS-Model", safeDetail.providerModel);
  return res.status(status).json({ error: errorCode, code: errorCode, ...(safeStageCode ? { stageCode: safeStageCode } : {}), ...(upstreamStatus ? { upstreamStatus } : {}), ...safeDetail });
}

function authorizeCron(req: express.Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const supplied = req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(configured);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
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
    } catch {
      console.warn(JSON.stringify({ event: "falha_verificacao_neon", operation: "health", errorCode: "database_unavailable" }));
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
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: "cron_not_configured" });
    if (!authorizeCron(req)) return res.status(401).json({ error: "unauthorized" });
    try {
      const result = await refreshRadar("Sistema", "cron");
      return res.json({ ok: true, total: result.total, classifiedByLLM: result.classifiedByLLM, collectedAt: result.collectedAt, sources: result.sources });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "Radar unavailable";
      return res.status(502).json({ error: "radar_refresh_failed", message });
    }
  });

  /** Etapa D — processa fila de video_gen (submit no provider / mock). */
  app.get("/api/cron/video-gen-queue", async (req, res) => {
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: "cron_not_configured" });
    if (!authorizeCron(req)) return res.status(401).json({ error: "unauthorized" });
    try {
      const result = await processVideoGenQueue(5);
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "video_gen queue failed";
      return res.status(502).json({ error: "video_gen_queue_failed", message });
    }
  });

  /** Etapa D — consulta jobs running e finaliza clips prontos. */
  app.get("/api/cron/video-gen-poll", async (req, res) => {
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: "cron_not_configured" });
    if (!authorizeCron(req)) return res.status(401).json({ error: "unauthorized" });
    try {
      const result = await pollRunningVideoGenJobs(20);
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "video_gen poll failed";
      return res.status(502).json({ error: "video_gen_poll_failed", message });
    }
  });

  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });

  app.use(restoreYouTubeIntegrationPath);
  app.get("/api/integrations/youtube/start", async (req, res) => {
    const user = await readSession(req);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    try {
      const started = await startYouTubeOAuth(user.id, "default");
      return res.redirect(302, started.url);
    } catch {
      return res.status(503).json({ error: "youtube_oauth_unavailable" });
    }
  });

  app.get("/api/integrations/youtube/callback", async (req, res) => {
    const value = (input: unknown) => Array.isArray(input) ? input[0] : typeof input === "string" ? input : undefined;
    try {
      await handleYouTubeOAuthCallback({ code: value(req.query.code), state: value(req.query.state), error: value(req.query.error) });
      return res.redirect(302, "/integracoes?youtube=connected");
    } catch (error) {
      const code = error instanceof YouTubeOAuthError ? error.code : "youtube_connection_failed";
      const allowed = new Set(["youtube_consent_denied", "youtube_callback_missing_parameters", "youtube_state_invalid", "youtube_owner_mismatch", "youtube_scope_rejected", "youtube_code_rejected", "youtube_channel_not_found", "youtube_multiple_channels", "youtube_not_configured", "youtube_connection_failed"]);
      return res.redirect(302, `/integracoes?youtube=error&reason=${encodeURIComponent(allowed.has(code) ? code : "youtube_connection_failed")}`);
    }
  });

  /** Endpoints privados chamados apenas pelo workflow autenticado via HMAC. */
  app.post("/api/render", async (req, res) => {
    const operation = typeof req.query.op === "string" ? req.query.op : "";
    const safeOperation: RenderOperation = isRenderOperation(operation) ? operation : "unknown";
    const signedPath = operation === "manifest" ? RENDER_PATHS.manifest : operation === "voice" ? RENDER_PATHS.voice : operation === "input" ? RENDER_PATHS.input : operation === "image" ? RENDER_PATHS.image : operation === "callback" ? RENDER_PATHS.callback : undefined;
    if (!signedPath) return sendRenderFailure(res, safeOperation, 404, "render_operation_not_found");
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
    if (!verifyRenderRequestSignature(rawBody, req.get("x-render-signature"), process.env.STUDIO_RENDER_HMAC_SECRET, { method: "POST", path: signedPath })) {
      if (operation === "callback") {
        const diagnostic = callbackStageDiagnostic("assinatura");
        return sendRenderFailure(res, safeOperation, 401, diagnostic.errorCode, undefined, diagnostic);
      }
      return sendRenderFailure(res, safeOperation, 401, "render_unauthorized");
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      if (operation === "callback") {
        const diagnostic = callbackStageDiagnostic("validacao_payload");
        return sendRenderFailure(res, safeOperation, 400, diagnostic.errorCode, undefined, diagnostic);
      }
      return sendRenderFailure(res, safeOperation, 400, "invalid_json_body");
    }
    try {
      if (operation === "manifest") {
        if (typeof req.body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.jobId)) return sendRenderFailure(res, safeOperation, 400, "invalid_job_id");
        const result = await getSignedRenderManifest(req.body.jobId);
        res.set("X-Render-Response-Signature", result.signature).type("application/json").send(result.body);
        return;
      }
      if (operation === "voice") {
        if (typeof req.body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.jobId) || !Number.isInteger(req.body.chunkIndex)) return sendRenderFailure(res, safeOperation, 400, "invalid_voice_request");
        const result = await synthesizeRenderChunk(req.body.jobId, req.body.chunkIndex);
        res.set("X-Render-Response-Signature", result.signature).set("X-Render-Model", result.model).set("X-Render-Voice", result.voice).set("X-Render-Fallback", String(result.fallback)).set("X-Render-Cache", String(result.cached)).type("audio/wav").send(result.audio);
        return;
      }
      if (operation === "input") {
        if (typeof req.body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.jobId) || typeof req.body.inputAssetId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.inputAssetId)) return sendRenderFailure(res, safeOperation, 400, "invalid_input_request");
        const result = await getSignedRenderInput(req.body.jobId, req.body.inputAssetId);
        res.set("X-Render-Response-Signature", result.signature).set("X-Render-SHA256", result.sha256).set("X-Render-File-Name", result.fileName).type(result.contentType).send(result.data);
        return;
      }
      if (operation === "image") {
        if (typeof req.body.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.jobId) || typeof req.body.assetId !== "string" || !/^[a-f0-9]{64}$/i.test(req.body.assetId)) return sendRenderFailure(res, safeOperation, 400, "invalid_image_request");
        const result = await getSignedRenderImage(req.body.jobId, req.body.assetId);
        res.set("X-Render-Response-Signature", result.signature).set("X-Render-SHA256", result.sha256).set("X-Render-File-Name", result.fileName).type(result.contentType).send(result.data);
        return;
      }
      const result = await processRenderCallback(req.body);
      return res.json({ ok: true, ...result });
    } catch (error) {
      const diagnostic = classifyRenderFailure(safeOperation, error);
      return sendRenderFailure(res, safeOperation, 400, diagnostic.errorCode, diagnostic.upstreamStatus, diagnostic);
    }
  });

  registerRenderDeliveryRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
}

export function restoreYouTubeIntegrationPath(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const segments = req.query.__segments;
  if (typeof segments === "string" && /^[a-z0-9/_-]+$/i.test(segments) && !segments.includes("//")) {
    const queryIndex = req.url.indexOf("?");
    const params = new URLSearchParams(queryIndex >= 0 ? req.url.slice(queryIndex + 1) : "");
    params.delete("__segments");
    const encodedQuery = params.toString();
    const rest = encodedQuery ? `?${encodedQuery}` : "";
    req.url = `/api/integrations/${segments}${rest}`;
    delete req.query.__segments;
  }
  next();
}
