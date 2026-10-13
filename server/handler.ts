import "dotenv/config";
import express from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerApiRoutes } from "./app";

/**
 * Aplicação Express do Estúdio.
 *
 * Este arquivo é o ponto de entrada do servidor e é empacotado por esbuild em
 * `dist/server.mjs` (um único arquivo, sem imports relativos sem extensão).
 * Isso é obrigatório na Vercel: as funções rodam em Node ESM, que exige
 * extensão explícita em todo import relativo.
 *
 * Nenhuma integração opcional pode derrubar a inicialização. Se um segredo
 * (Neon, provedor de LLM, OAuth) estiver ausente, a rota responde com estado
 * "não configurado" em vez de quebrar o processo.
 */
export function createStudioApp() {
  const app = express();

  registerApiRoutes(app);

  // API desconhecida continua retornando 404 JSON, sem cair no HTML do SPA.
  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));

  // O frontend compilado vive em public/ e é servido pela CDN da Vercel.
  // O static e o fallback abaixo cobrem execução local e hosts que enviem
  // requisições de arquivos para a função.
  const publicDir = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDir));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"), error => {
      if (error && !res.headersSent) {
        res
          .status(503)
          .type("text/plain")
          .send("Aplicação ainda não compilada. Tente novamente em instantes.");
      }
    });
  });

  // Nunca deixar um erro de rota derrubar a função: resposta JSON previsível.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = error instanceof Error ? error.message : "Erro interno inesperado";
      console.error("[Estúdio] Erro não tratado em rota:", message);
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}

const app = createStudioApp();

export default app;

// Execução local (`node dist/server.mjs` ou `pnpm start`). Na Vercel o app é
// importado como handler e este bloco não roda.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env.PORT || "3000");
  app.listen(port, "0.0.0.0", () => {
    console.log(`[Estúdio] Servidor local em http://0.0.0.0:${port}`);
  });
}