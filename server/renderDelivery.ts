import type { Express, Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readSession } from "./auth";
import { getRenderDownloadAsset } from "./renderPipeline";

export const RENDER_DELIVERY_STAGE_CODES = [
  "sessao_invalida",
  "job_id_invalido",
  "asset_ausente",
  "asset_lookup_falhou",
  "token_ausente",
  "redirect_invalido",
  "upstream_indisponivel",
  "range_nao_suportado",
  "stream_falhou",
] as const;
export type RenderDeliveryStageCode = (typeof RENDER_DELIVERY_STAGE_CODES)[number];
export type RenderDeliveryOperation = "download" | "preview";

type RenderAsset = NonNullable<Awaited<ReturnType<typeof getRenderDownloadAsset>>>;
type RenderDeliveryLogRecord = {
  event: "falha_entrega_render";
  operation: RenderDeliveryOperation;
  stageCode: RenderDeliveryStageCode;
  httpStatus: number;
  upstreamStatus?: number;
};
type RenderDeliveryDependencies = {
  readSession: (req: Request) => Promise<unknown>;
  getAsset: (jobId: string) => Promise<RenderAsset | null>;
  getToken: () => string | undefined;
  fetchImpl: typeof fetch;
  log: (record: RenderDeliveryLogRecord) => void;
};

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_API_BASE = "https://api.github.com/repos/jadiel054/estudio-canal-ia/releases/assets/";
const GITHUB_API_VERSION = "2022-11-28";

function encodeFilename(fileName: string) {
  return encodeURIComponent(fileName).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function isGitHubAssetRedirect(location: string) {
  try {
    const url = new URL(location);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === "githubusercontent.com"
      || host.endsWith(".githubusercontent.com")
      || host === "github-cloud.s3.amazonaws.com"
      || host === "github-production-release-asset-2e65be.s3.amazonaws.com";
    return url.protocol === "https:" && allowedHost;
  } catch {
    return false;
  }
}

function sendDeliveryFailure(
  res: Response,
  dependencies: RenderDeliveryDependencies,
  operation: RenderDeliveryOperation,
  stageCode: RenderDeliveryStageCode,
  httpStatus: number,
  upstreamStatus?: number,
) {
  const safeUpstreamStatus = Number.isInteger(upstreamStatus) && upstreamStatus! >= 100 && upstreamStatus! <= 599
    ? upstreamStatus
    : undefined;
  const record: RenderDeliveryLogRecord = {
    event: "falha_entrega_render",
    operation,
    stageCode,
    httpStatus,
    ...(safeUpstreamStatus !== undefined ? { upstreamStatus: safeUpstreamStatus } : {}),
  };
  dependencies.log(record);
  res.set("X-Render-Stage-Code", stageCode);
  if (safeUpstreamStatus !== undefined) res.set("X-Render-Upstream-Status", String(safeUpstreamStatus));
  return res.status(httpStatus).json({ error: "render_delivery_failed", stageCode });
}

function requestJobId(req: Request) {
  const pathJobId = req.params.jobId;
  if (typeof pathJobId === "string") return pathJobId;
  const queryJobId = req.query.jobId;
  return typeof queryJobId === "string" ? queryJobId : "";
}

function createDeliveryHandler(operation: RenderDeliveryOperation, dependencies: RenderDeliveryDependencies) {
  return async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store, private");
    try {
      if (!(await dependencies.readSession(req))) {
        return sendDeliveryFailure(res, dependencies, operation, "sessao_invalida", 401);
      }
    } catch {
      return sendDeliveryFailure(res, dependencies, operation, "sessao_invalida", 401);
    }

    const jobId = requestJobId(req);
    if (!JOB_ID_PATTERN.test(jobId)) {
      return sendDeliveryFailure(res, dependencies, operation, "job_id_invalido", 400);
    }

    let asset: RenderAsset | null;
    try {
      asset = await dependencies.getAsset(jobId);
    } catch {
      return sendDeliveryFailure(res, dependencies, operation, "asset_lookup_falhou", 503);
    }
    if (!asset) return sendDeliveryFailure(res, dependencies, operation, "asset_ausente", 404);

    const token = dependencies.getToken();
    if (!token?.trim()) return sendDeliveryFailure(res, dependencies, operation, "token_ausente", 503);

    try {
      const range = req.get("range");
      const signal = AbortSignal.timeout(45_000);
      const apiResponse = await dependencies.fetchImpl(`${GITHUB_API_BASE}${asset.assetId}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/octet-stream",
          "x-github-api-version": GITHUB_API_VERSION,
          ...(range ? { range } : {}),
        },
        redirect: "manual",
        signal,
      });

      let fileResponse = apiResponse;
      if (apiResponse.status >= 300 && apiResponse.status < 400) {
        const location = apiResponse.headers.get("location");
        if (!location || !isGitHubAssetRedirect(location)) {
          return sendDeliveryFailure(res, dependencies, operation, "redirect_invalido", 502, apiResponse.status);
        }
        // A URL assinada do asset nunca é registrada nem devolvida ao browser. O PAT
        // é enviado apenas à API do GitHub e nunca ao host do asset redirecionado.
        fileResponse = await dependencies.fetchImpl(location, {
          headers: range ? { range } : {},
          signal,
        });
      }

      if (fileResponse.status === 416) {
        res.status(416).set("Accept-Ranges", "bytes");
        const contentRange = fileResponse.headers.get("content-range");
        if (contentRange) res.set("Content-Range", contentRange);
        return res.end();
      }
      if (!fileResponse.ok || !fileResponse.body) {
        const stageCode = fileResponse.status === 404 ? "asset_ausente" : "upstream_indisponivel";
        const status = fileResponse.status === 404 ? 404 : 502;
        return sendDeliveryFailure(res, dependencies, operation, stageCode, status, fileResponse.status);
      }
      if (range && fileResponse.status !== 206) {
        return sendDeliveryFailure(res, dependencies, operation, "range_nao_suportado", 502, fileResponse.status);
      }

      res.status(fileResponse.status)
        .set("Content-Type", "video/mp4")
        .set("Accept-Ranges", "bytes")
        .set("Cache-Control", "no-store, private")
        .set("Content-Disposition", `${operation === "download" ? "attachment" : "inline"}; filename*=UTF-8''${encodeFilename(asset.fileName)}`);
      for (const header of ["content-length", "content-range"]) {
        const value = fileResponse.headers.get(header);
        if (value) res.set(header, value);
      }
      await pipeline(Readable.fromWeb(fileResponse.body as any), res);
    } catch {
      if (res.headersSent) {
        dependencies.log({ event: "falha_entrega_render", operation, stageCode: "stream_falhou", httpStatus: 502 });
        res.destroy();
        return;
      }
      return sendDeliveryFailure(res, dependencies, operation, "upstream_indisponivel", 502);
    }
  };
}

/**
 * Os caminhos públicos /download/:jobId e /preview/:jobId também são registrados
 * diretamente para execução local. Em Vercel standalone, os rewrites levam esses
 * caminhos ao Function estático /api/render com delivery/jobId na query string.
 */
export function registerRenderDeliveryRoutes(app: Express, overrides: Partial<RenderDeliveryDependencies> = {}) {
  const dependencies: RenderDeliveryDependencies = {
    readSession,
    getAsset: getRenderDownloadAsset,
    getToken: () => process.env.GITHUB_ACTIONS_TOKEN,
    fetchImpl: globalThis.fetch.bind(globalThis),
    log: record => console.warn(JSON.stringify(record)),
    ...overrides,
  };
  const download = createDeliveryHandler("download", dependencies);
  const preview = createDeliveryHandler("preview", dependencies);

  app.get("/api/render/download/:jobId", download);
  app.get("/api/render/preview/:jobId", preview);
  app.get("/api/render", (req, res, next) => {
    const delivery = req.query.delivery;
    if (delivery === "download") return download(req, res);
    if (delivery === "preview") return preview(req, res);
    return next();
  });
}
