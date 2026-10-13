// Ponto de entrada serverless para /api/trpc/*.
//
// A pasta `api/` da Vercel casa apenas um segmento por arquivo dinâmico em
// projetos que não são Next.js, por isso cada prefixo de múltiplos segmentos
// ganha o seu próprio arquivo. Todos reutilizam o MESMO bundle Express
// (dist/server.mjs), então continua existindo uma única aplicação.
export { default } from "../../dist/server.mjs";