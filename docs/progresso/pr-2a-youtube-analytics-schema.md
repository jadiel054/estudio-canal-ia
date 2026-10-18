# PR-2A — schema de Analytics YouTube

**Status:** implementação local publicada em PR, sem merge e sem aplicação no Neon.

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

## Próximo passo condicionado

Após a revisão/merge e autorização separada, aplicar a migration no branch `main` do Neon e validar somente em leitura: quatro tabelas, colunas, índices, constraints e ausência de alteração indevida do Radar público. Só depois do relatório e da autorização do dono iniciar a validação da PR-2B com a conexão readonly existente.
