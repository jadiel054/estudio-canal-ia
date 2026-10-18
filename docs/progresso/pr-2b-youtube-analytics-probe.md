# PR-2B-probe — diagnóstico de escopo YouTube Analytics

**Status:** PR sem merge; nenhum teste real executado nesta branch.

## Escopo implementado

A PR adiciona o procedimento tRPC owner-only `youtube.probeAnalytics`, limitado a uma chamada por minuto por usuário autenticado. O procedimento:

1. localiza o canal YouTube conectado do dono no Neon, sem retornar o identificador;
2. reutiliza `refreshYouTubeAccessToken`, que mantém o token cifrado no servidor e usa o lock de refresh existente;
3. chama `https://youtubeanalytics.googleapis.com/v2/reports` com `ids=channel==MINE`, filtro pelo canal conectado, janela inclusiva de sete datas até ontem, dimensões `day,video` e métricas `views`, `averageViewPercentage`, `averageViewDuration`, `subscribersGained` e `subscribersLost`;
4. retorna somente `status`, `rowCount` e `nonNullMetrics`.

Os status permitidos são exatamente `ok`, `auth_insufficient`, `quota_exceeded`, `not_ready` e `network_error`. Nenhuma linha, título, valor de métrica, token ou resposta bruta é persistida ou enviada ao cliente.

A UI exibe o botão **Diagnóstico Analytics** somente quando o usuário é admin e o YouTube está conectado. O resultado é mostrado em toast e em um painel sanitizado no card de Integrações.

## Tratamento de erros

- HTTP 401/403: `auth_insufficient`;
- HTTP 429: `quota_exceeded`;
- canal ausente ou resposta HTTP não pronta: `not_ready`;
- timeout/falha de rede/resposta JSON ilegível: `network_error`.

A PR não amplia escopos OAuth, não reconecta a conta, não coleta dados para as tabelas da PR-2A e não inicia a PR-2B collector.

## Evidência de contrato externo

A referência oficial de `reports.query` documenta `ids=channel==MINE`, `startDate`, `endDate`, `metrics` e dimensões; o exemplo oficial também usa `averageViewPercentage`, `averageViewDuration` e `subscribersGained`. A própria documentação indica o escopo `yt-analytics.readonly` para o fluxo de autorização. Fonte: https://developers.google.com/youtube/analytics/reference/reports/query

## Validação local

- probe offline: **5/5 testes**;
- suíte Vitest completa: **36 arquivos, 231 testes**;
- `pnpm check`: passou;
- `pnpm build`: passou;
- `git diff --check`: passou;
- nenhum endpoint Google real foi chamado.

## Próximo passo

Depois do merge e deploy, o dono deve clicar em **Diagnóstico Analytics** em produção. O único resultado necessário para decidir a PR-2B é o enum retornado:

- `ok`: seguir com o mesmo escopo/contrato validado;
- `auth_insufficient`: reportar a evidência e aguardar decisão explícita sobre reconectar com `yt-analytics.readonly`;
- demais enums: diagnosticar sem persistir dados e sem ampliar escopo automaticamente.
