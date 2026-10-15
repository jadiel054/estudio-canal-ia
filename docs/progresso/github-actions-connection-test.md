# Diagnóstico de conexão do GitHub Actions

## Implementação

A tela **Integrações** ganhou o botão manual **Testar conexão**. O teste usa uma rota `adminProcedure` e `requiredActionsToken()` para fazer somente `GET /repos/jadiel054/estudio-canal-ia/releases?per_page=1`. A operação não dispara workflows, não cria releases e não altera o repositório. O endpoint tem limite de uma chamada por minuto por usuário.

O servidor retorna apenas `ok`, `unauthorized`, `forbidden`, `not_found` ou `network_error`, acompanhados do status HTTP (ou `null` quando não há resposta) e da latência. Não lê o corpo da resposta, não registra a exceção e não devolve token nem headers. A interface só mostra **Conectado** após resposta HTTP 2xx; 401, 403, 404 e falhas de rede/HTTP aparecem em vermelho com o código específico.

## Validação

`pnpm check` passou; `pnpm test` passou com 145 testes; `python3 -m unittest discover -s scripts -v` passou com 18 testes; `pnpm build` passou. O build manteve os avisos existentes do Vite sobre `config.js` sem `type="module"` e tamanho do bundle.

Os testes de conexão usam `fetch` mockado para os estados 200, 401, 403, 404, 503, exceção de rede e token ausente. Nenhuma chamada real à API GitHub foi executada durante esta implementação. Não houve render de produção, deploy ou merge.
