# PR-4C — fiação do provider visual (flag off)

## Escopo

- Adicionado transporte server-side do Cloudflare Workers AI com timeout, Bearer token vindo de `CLOUDFLARE_API_TOKEN`, Account ID vindo de `CLOUDFLARE_ACCOUNT_ID` e parsing de imagem Base64/bytes.
- A instância padrão só injeta o transporte quando as duas variáveis existem. A política visual continua bloqueada e `STUDIO_IMAGE_GENERATION_ENABLED` ausente continua desligada.
- O preparo do render deriva apenas `Visual:` por seção depois do commit do job. Consulta cache, registra bloqueio/reserva conforme a camada existente e nunca impede o fallback do worker.
- Nenhum provider real foi chamado, nenhum render foi executado e nenhum gasto foi realizado.

## Guardrails

- Prompt/direção visual não é escrito em logs; resultados expõem somente status e motivo sanitizado.
- A licença/termos/revisão/custo continuam bloqueando geração mesmo com flag e credenciais presentes.
- O modelo permanece `@cf/black-forest-labs/flux-2-klein-4b`, com a revisão interna ainda explicitamente não pinada.

## Referência técnica

A documentação oficial do Cloudflare descreve o endpoint REST por Account ID com `Authorization: Bearer`, e o catálogo do FLUX.2 klein descreve a resposta `image` em Base64. O contrato do modelo ainda indica entrada multipart; o client mantém o transporte isolado e testado, sem habilitação nesta PR.

- https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/
- https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/schema-output.json

## Validação

- `pnpm check` — passou.
- `pnpm exec vitest run server/cloudflareImageProvider.test.ts server/renderVisualPreparation.test.ts server/imageGeneration.test.ts server/renderPipeline.test.ts` — 4 arquivos, 29 testes, passou.
