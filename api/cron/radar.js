// Rota explícita para o Cron: o catch-all api/[...path].js deste projeto atende
// apenas segmentos simples em produção; este adaptador garante o caminho aninhado.
import app from "../../dist/server.mjs";

export const maxDuration = 50;

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  req.url = "/api/cron/radar";
  return app(req, res);
}
