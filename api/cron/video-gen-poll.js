// Cron: consulta jobs running e finaliza quando o provider concluir.
import app from "../../dist/server.mjs";

export const maxDuration = 50;

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }
  req.url = "/api/cron/video-gen-poll";
  return app(req, res);
}
