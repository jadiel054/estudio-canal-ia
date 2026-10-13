# Etapa 1 — Correção do erro 500 (FUNCTION_INVOCATION_FAILED)

Data: 2026-10-13 · Responsável: agente Manus · Repositório: `jadiel054/estudio-canal-ia`

## Causa raiz (comprovada nos Runtime Logs da Vercel)

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/server/app'
imported from /var/task/index.js
Did you mean to import "./server/app.js"?
  runtime=nodejs22.x  dep=dpl_BbFjZE37AKrRvUw8t8rkZT8trBrT
```

O deploy era detectado como framework **express**. Nesse modo a Vercel compila cada
arquivo do servidor **isoladamente** e mantém os imports relativos como escritos no
código (`import { registerApiRoutes } from "./server/app"`). Como o `package.json`
declara `"type": "module"`, o runtime executa o resultado como **ESM**, e o Node ESM
exige **extensão explícita** em todo import relativo. Resultado: a função morria no
carregamento, antes de qualquer rota — por isso **todas** as rotas (incluindo
`/api/health`) devolviam `500 FUNCTION_INVOCATION_FAILED`.

Não era variável de ambiente ausente, nem Neon aberto no import, nem dependência do
runtime anterior do Manus. Era o formato de build para a Vercel.

Segundo problema, descoberto na verificação: na pasta `api/` a Vercel casa apenas
**um segmento** por arquivo dinâmico em projetos que não são Next.js (a sintaxe
`[...slug].js` é um recurso do Next.js). Assim, `/api/health` funcionava, mas
`/api/trpc/auth.me` e `/api/oauth/callback` retornavam 404 da plataforma.

## O que mudou

| Arquivo | Mudança |
| --- | --- |
| `server/handler.ts` | Nova entrada única do servidor, empacotada por esbuild em `dist/server.mjs` (sem imports relativos sem extensão), com fallback do SPA e handler de erro que impede a função de morrer. |
| `server/app.ts` | `/api/health` agora reporta **app** e **Neon** e nunca lança: sem banco configurado responde "não configurado" em vez de quebrar. |
| `api/[...path].js` | Função serverless para `/api/<um segmento>` (ex.: `/api/health`). |
| `api/trpc/[...path].js` | Função serverless para `/api/trpc/*`. |
| `api/oauth/[...path].js` | Função serverless para `/api/oauth/*` (callback de login). |
| `vercel.json` | `framework: null` (desliga o preset Express), `outputDirectory: public`, `buildCommand: pnpm run build` e rewrite do SPA preservando `/api`. |
| `package.json` | `build` passa a gerar `dist/server.mjs` (`build:server`); `start` aponta para ele. |
| `index.ts` (raiz) | Removido — era a entrada que quebrava no ESM. |

Os três arquivos em `api/` reutilizam **o mesmo bundle Express**, então continua
havendo uma única aplicação; apenas os prefixos de múltiplos segmentos ganham
ponto de entrada próprio, como a plataforma exige.

## Como foi testado

1. **Logs reais** da Vercel (Runtime Logs do deployment `dpl_BbFjZE37AKrRvUw8t8rkZT8trBrT`)
   identificaram o `ERR_MODULE_NOT_FOUND` acima.
2. **Réplica local** do mesmo artefato: `pnpm run build` + `NODE_ENV=production node dist/server.mjs`,
   com verificação de status e corpo de cada rota.
3. **`pnpm run check`** (tsc) e **`pnpm test`** (vitest): 10 testes, 3 arquivos, todos aprovados.
4. **Produção** após o deploy, em `https://estudio-canal-ia.vercel.app`:

| Rota | Resultado |
| --- | --- |
| `/`, `/radar`, `/pautas`, `/roteiros`, `/estudio`, `/fila`, `/publicacoes`, `/lives`, `/analytics`, `/agente`, `/integracoes`, `/configuracoes`, `/logs` | `200` `text/html` |
| `/api/health` | `200` JSON — `{"app":{"ok":true,"environment":"production","region":"gru1"},"database":{"reachable":true,"mode":"neon","tableCount":16}}` |
| `/api/trpc/auth.me` | `200` JSON (deslogado: `{"result":{"data":{"json":null}}}`) |
| `/api/oauth/callback` (sem parâmetros) | `400` JSON `{"error":"code and state are required"}` — chegou na aplicação |
| `/api/platform/config.js` | `200` `application/javascript` |
| `/api/inexistente` | `404` JSON `{"error":"API route not found"}` |
| `/manifest.webmanifest`, `/service-worker.js`, `/assets/*.js` | `200` com os tipos corretos |

`/api/health` comprova a conexão com o Neon: `tableCount: 16`, as 16 tabelas do projeto dedicado.

## Commits

- `eb24285` — `fix(vercel): corrigir FUNCTION_INVOCATION_FAILED no carregamento da função`
- `433e318` — `fix(vercel): atender rotas /api com mais de um segmento`

Um commit intermediário (`56ee224`) foi **bloqueado** pela Vercel (`BLOCKED`, autor do
commit fora do time). A Vercel bloqueia deployments cujo autor do commit não pertence à
conta. Os commits foram refeitos com a identidade do operador (`jadielalves54@gmail.com`).

## O que ainda depende do operador

- Nada para esta etapa: o site carrega, as rotas principais respondem e o Neon está conectado.
- Para a **Etapa 2** (login próprio + Nexo com LLM independente do Manus) será necessária
  uma chave gratuita de provedor de LLM (Google AI Studio/Gemini ou Groq) cadastrada como
  segredo na Vercel. Nenhuma chave entra no código.