// Adapter explícito para caminhos aninhados /api/integrations/*.
// Mantém o mesmo bundle Express do catch-all principal quando a plataforma
// não materializa api/[...path].js para segmentos aninhados.
import app from "../../../dist/server.mjs";

export const maxDuration = 50;
export default app;
