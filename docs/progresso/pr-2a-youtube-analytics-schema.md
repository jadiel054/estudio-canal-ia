# PR-2A — schema de Analytics YouTube

**Status:** implementação publicada na PR #28, sem merge; migration aplicada e validada no Neon `main`.

## Escopo

Esta PR adiciona uma migration aditiva em `database/youtube-analytics-migration.sql` com quatro entidades novas:

- `analytics_collection_runs`: execução por canal e slot lógico UTC de 09:00, janela de datas Pacific, lease, contagens, estados `running/success/partial/not_ready/failed` e erro sanitizado;
- `youtube_video_daily_metrics`: grão `(channel_id, youtube_video_id, metric_date)`, métricas diárias e campos nullable para dados não disponíveis;
- `analytics_insights`: resultados derivados versionados com evidências JSONB, confiança e status;
- `radar_learning_signals`: sinal interno vinculado a insight, separado de `radar_signals` público.

A migration preserva `analytics_snapshots` legado, não contém `DROP`, `DELETE` ou `TRUNCATE`, não armazena token/segredo/resposta bruta e não aplica DDL automaticamente.

## Decisões registradas

A data da fonte é rotulada com `source_timezone = America/Los_Angeles`. `thumbnail_ctr` permanece nullable e não é preenchido por CTR de cards/anotações. `subscribers_gained` e `subscribers_lost` são colunas independentes; o líquido será derivado na camada de leitura. O schema não implementa collector, cron, refresh de token, consulta `Analytics.reports.query` ou Reporting API.

A validação operacional obrigatória dos métodos e escopos ainda não foi executada nesta PR. Em particular, a conexão OAuth existente foi concedida apenas com `youtube.readonly` no fluxo do Item 1; não será presumido que isso autorize `Analytics.reports.query`, `yt-analytics.readonly` ou `channel_reach_basic_a1`. A PR-2B permanece bloqueada até teste autorizado e decisão explícita sobre qualquer ampliação de escopo.

## Validação local

- teste estático da migration: cobre quatro entidades, grão, nullable, lease, estados, erro sanitizado e separação do Radar;
- nenhum SQL foi executado no Neon;
- nenhum token, provider ou endpoint real foi chamado nesta PR.

## Aplicação e validação Neon

Migration aplicada em uma única transação no projeto `estudio-canal-ia`, branch `main`, banco `estudio_canal_ia`. A validação posterior foi somente de leitura e retornou:

- tabelas novas: **4/4**;
- colunas esperadas: **15/15** em `analytics_collection_runs`, **19/19** em `youtube_video_daily_metrics`, **10/10** em `analytics_insights` e **9/9** em `radar_learning_signals`;
- índices da migration: **13/13**;
- constraints: CHECKs presentes nas quatro tabelas, FKs presentes nas quatro tabelas e unicidade/PKs naturais preservadas;
- linhas de negócio consultadas: **nenhuma**; somente metadados do catálogo foram retornados.

Ainda não foi feita a chamada operacional a `Analytics.reports.query` nem à Reporting API. Isso permanece como validação prévia separada antes de qualquer código da PR-2B, sem ampliação do escopo OAuth.

## Próximo passo condicionado

Após a revisão/merge e autorização separada, aplicar a migration no branch `main` do Neon e validar somente em leitura: quatro tabelas, colunas, índices, constraints e ausência de alteração indevida do Radar público. Só depois do relatório e da autorização do dono iniciar a validação da PR-2B com a conexão readonly existente.
