// Função serverless da Vercel (runtime Node.js/ESM) que atende todas as rotas
// /api/*.
//
// O bundle `dist/server.mjs` é gerado pelo script "build" (esbuild) e contém
// toda a aplicação Express em um único arquivo. O import abaixo usa caminho
// relativo com extensão explícita, exigência do Node ESM em produção.
export { default } from "../dist/server.mjs";