// Ponto de entrada serverless para /api/oauth/* (callback de login).
// Mesmo bundle Express usado pelos demais pontos de entrada da pasta `api/`.
export { default } from "../../dist/server.mjs";