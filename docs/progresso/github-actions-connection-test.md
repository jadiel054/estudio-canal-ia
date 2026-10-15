# Diagnóstico de conexão do GitHub Actions

## Implementação

A tela **Integrações** oferece o botão manual **Testar conexão**. A rota `adminProcedure` usa `requiredActionsToken()` e mantém limite de uma execução por minuto por usuário. A primeira chamada faz `GET /repos/jadiel054/estudio-canal-ia/releases?per_page=1`. Se o primeiro item for draft, o servidor extrai somente `id` e `draft` e então faz `GET /repos/.../releases/{id}`. Não lê o corpo da resposta por ID, não registra conteúdo/erros/segredos e não devolve ID, token ou headers. Não dispara workflows, cria releases nem altera o repositório.

O retorno contém `listStatus`, `draftFound`, `getByIdStatus` e latência; statuses são numéricos e `null` indica que não houve resposta. A interface apresenta listagem e busca por ID lado a lado. Distingue listagem não-OK, ausência de draft, GET por ID 200, 404, outros status HTTP e falha de rede/timeout.

## Validação

`pnpm check` passou; `pnpm test` passou com 148 testes; `pnpm build` passou. O build manteve os avisos do Vite sobre `config.js` sem `type="module"` e o tamanho do bundle.

Os testes usam `fetch` mockado para listagem 200 + draft + GET por ID 200, listagem 200 + draft + GET por ID 404, listagem 200 sem draft, listagem 401/403/404/503, falha de rede e token ausente. Nenhuma chamada real à API GitHub foi executada durante esta implementação. Não houve render nem deploy de produção; a PR permanece sem merge.
