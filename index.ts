import "dotenv/config";
import express from "express";
import path from "node:path";
import { registerApiRoutes } from "./server/app";

const app = express();
registerApiRoutes(app);

// APIs desconhecidas continuam retornando 404 JSON, sem mascarar erros com o app SPA.
app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));

// O frontend compilado fica em public/ e é servido pela CDN da Vercel.
// Este fallback cobre as rotas internas do PWA, como /radar e /configuracoes.
app.get("*", (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), "public", "index.html"), error => {
    if (error && !res.headersSent) {
      res.status(503).type("text/plain").send("Aplicação ainda não compilada. Tente novamente em instantes.");
    }
  });
});

export default app;
