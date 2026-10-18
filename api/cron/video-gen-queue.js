// Cron: processa fila de video_gen_jobs (submit no provider).
// Protegido por HMAC (STUDIO_RENDER_HMAC_SECRET) — mesmo padrão do render.
import app from "../../dist/server.mjs";

export const maxDuration = 50;

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }
  req.url = "/api/cron/video-gen-queue";
  return app(req, res);
}
