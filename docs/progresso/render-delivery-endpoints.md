# Entrega autenticada de MP4 — investigação e correção proposta

## Diagnóstico do 404

A busca do request ID `gru1::jp7xt-1792111393802-ef42d9b5af79` nos logs de runtime do Vercel não retornou registros, tanto com o ID completo quanto sem o prefixo de região. A consulta agrupada de erros também não encontrou erro de runtime. O ID situa a requisição em `2026-10-16T00:43:13.802Z`. A consulta de deployments retornou como último deployment de produção o `READY` no SHA `a28cbb220521766ffb2d891b418e94da7f1b664f`, criado em `2026-10-16T00:19:23.257Z`. A superfície de logs conectada mostra saída de Functions já invocadas, não os registros de request/edge que conteriam o path de um 404 anterior à Function. Portanto, o path literal daquela requisição não pôde ser extraído do request ID com o acesso disponível. O caminho esperado no client era `/api/render/download/:jobId?download=1`.

A comparação do código encontrou três pontos relevantes. O player e o botão usavam `/api/render/download/:jobId`; o Express registrava apenas essa rota e escolhia `inline` ou `attachment` por query string, sem uma rota dedicada de preview. O rewrite SPA exclui `/api/`, então não deveria converter esses caminhos em `/index.html`. Porém, o deploy é Vite/Express standalone, sem Next.js, e dependia do arquivo `api/render/[...path].js` como única entrada serverless para rotas aninhadas. A documentação de configuração Vercel confirma que o filesystem é avaliado antes de rewrites [1]. A referência de Functions documenta as entradas em `/api`, mas não atribui dynamic catch-all de Next.js a funções standalone [2]; uma resposta da comunidade Vercel esclarece que a sintaxe `[...]` de catch-all discutida é específica do Next.js [3]. Esse é o candidato estrutural mais forte para o 404 no edge.

## Alterações nesta frente

O catch-all foi removido como dependência. Os caminhos públicos de download e preview agora têm rewrites explícitos para a entrada estática já existente `/api/render`, levando `delivery` e `jobId` na query. A URL pública permanece `/api/render/download/:jobId` ou `/api/render/preview/:jobId`; o rewrite não publica nem muda nenhum estado de produção. O player aponta para `/preview`, enquanto o link de download mantém `/download` e sempre recebe `Content-Disposition: attachment`.

O proxy exige sessão em ambos os caminhos. Ele solicita o asset pela API autenticada do GitHub, valida o host do redirect HTTPS e não envia o PAT ao host do asset. Repassa `Range` ao upstream e preserva status `206`, `Content-Range` e `Content-Length`. Falhas geram apenas `stageCode` de uma lista fixa; não registram nem retornam token, URL assinada, corpo upstream ou ID do job.

## Verificação

Os testes HTTP usam `fetch` mockado e cobrem download com bytes íntegros após redirect, preview inline, Range com `206`, sessão inválida, asset ausente, upstream indisponível e redirect fora do allowlist. Um teste de roteamento valida os rewrites e que eles precedem o fallback SPA. Nenhum endpoint do app de produção foi chamado durante esta investigação; não houve render, limpeza, merge ou deploy manual.

## Referências

[1]: https://vercel.com/docs/project-configuration/vercel-json "Vercel — Project Configuration with vercel.json"
[2]: https://vercel.com/docs/functions/functions-api-reference "Vercel — Functions API Reference"
[3]: https://github.com/vercel/community/discussions/947 "Vercel Community — Catch-all API routes outside Next.js"
