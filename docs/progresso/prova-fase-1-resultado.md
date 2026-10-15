# Prova ponta a ponta da Fase 1 — resultado

**Resultado atualizado em 15/10/2026: FALHA PARCIAL.** A prova TTS/cache e o Portão 1 foram concluídos. Duas execuções reais já ocorreram dentro do limite autorizado de até três jobs: o primeiro continua zumbi em `rendering` (88%) e o segundo terminou `failed` após HTTP 400 no callback de QA. Nenhum dos dois chegou ao Portão 2; não houve aprovação de vídeo, download, publicação ou limpeza dos drafts. Esta atualização complementa o registro histórico abaixo e substitui a contagem inicial de um job como estado operacional atual.

**Data:** 15/10/2026 — horário de São Paulo (UTC−03).

## Pré-voo

- PRs #4, #7 e #8 estavam mescladas. O deployment de produção estava `READY` no SHA `4324e3d2ef50606c839a7db273d7172a9e7451bb`, correspondente ao `main` após a PR #8.
- A migration TTS do PR #7 já estava aplicada e verificada na branch principal do Neon.
- O workflow de render usou esse SHA. Não houve deploy manual, alteração de segredo ou publicação no YouTube.

## Amostras TTS e cache

Os eventos de `studio_tts_usage` foram verificados diretamente, sem consultar texto ou áudio:

1. **15:46:11.127:** `api_call`, `purpose=connection_test`, `outcome=success`, HTTP 200, modelo `gemini-3.8-flash-tts`. A primeira amostra chamou o Gemini.
2. **15:48:21.782:** `cache_hit`, `purpose=connection_test`. A segunda amostra reutilizou o áudio; não houve nova chamada ao Gemini. O intervalo entre as amostras foi de 2 min 10 s, acima do limite de 1/min.
3. **16:05:32.660:** uma chamada `api_call` de `purpose=render`, `outcome=success`, HTTP 200, para a narração do vídeo.

A consulta de estimativa do manifesto registrou **9 cues e 1 bloco**. Depois da chamada de render, uma consulta somente de leitura indicou 1 bloco em cache e 0 chamadas novas estimadas. O job efetivamente realizou uma chamada Gemini para o render, registrada acima.

## Pauta, roteiro e Portão 1

Foi criada uma pauta Short identificada como teste: **“Teste de pipeline — IA e tokens: por que palavras podem virar partes”**. O roteiro foi gerado, revisado e submetido ao QA textual; a versão revisada foi aprovada no **Portão 1**. Uma captura simples foi anexada. Nenhum outro item editorial foi alterado.

## Render, callback e QA

Foi iniciado **um único job real**, sem retries:

- Job: `eb74bf31-8df1-4311-9766-c601976d4119`.
- [Execução GitHub Actions #38790905182](https://github.com/jadiel054/estudio-canal-ia/actions/runs/38790905182), no SHA de produção `4324e3d2ef50606c839a7db273d7172a9e7451bb`.
- Duração total do run: **1 min 55 s** (16:04:36–16:06:31). O runner executou por 1 min 51 s.
- Três callbacks de progresso `rendering` foram aceitos, entre 16:05:14.956 e 16:06:24.574. O último progresso registrado foi 88%.

O worker criou o draft Release privado `414172008` (`studio-render-eb74bf31-8df1-4311-9766-c601976d4119`) com dois assets. O MP4 tem **2.231.262 bytes**; o SRT, 1.066 bytes. Esses são metadados do Release, não uma aprovação de QA.

O callback final `status=qa` foi recusado com HTTP 400 e código seguro `callback_operation_failed`. O callback secundário de falha também foi recusado. O job permanece no Neon como `rendering`, 88%, sem `finished_at`, `error_code`, `release_id`, `asset_id`, `file_size_bytes` ou QA persistido. A aba **Fila** não mostrou este job em “Aguardando vídeo”; mostrou somente um item simulado preexistente, que não foi alterado.

Como o app não aceitou o callback, **nenhum dos cinco checks de QA pode ser afirmado como aprovado**:

- `video_stream`: não confirmado no app;
- `audio_stream`: não confirmado no app;
- `captions`: não confirmado no app;
- `duration`: não confirmado no app;
- `file_size`: não confirmado pelo callback — existe apenas o tamanho do asset no Release, informado acima.

Assim, o **Portão 2 permaneceu bloqueado**. Não aprovei o vídeo e não baixei o MP4.

## Diagnóstico e correção

A inspeção de leitura do schema de produção confirmou que `studio_render_jobs` não contém as colunas `http_status` e `upstream_status`, embora o caminho de callback `status=failed` execute um `UPDATE` que as utiliza. Esse descompasso explica por que o callback secundário não conseguiu persistir a falha e por que o job ficou preso em `rendering`.

A causa específica do primeiro HTTP 400 no callback de QA **não pôde ser determinada**: a resposta e os logs seguros expõem apenas `callback_operation_failed`, sem a etapa interna que rejeitou o callback. Não atribuo a falha à quota TTS: a chamada Gemini do render terminou com sucesso HTTP 200.

A correção de schema e seu teste estão na [PR #9](https://github.com/jadiel054/estudio-canal-ia/pull/9). **Atualização:** a PR #9 foi mesclada e as colunas da migration foram verificadas na branch `main` do Neon. A instrumentação da PR #10 também foi mesclada e está no deployment atual de produção.

A integração criou automaticamente o preview Vercel [READY](https://estudio-canal-3bn08e9vq-jadiels-projects-3b6be146.vercel.app), separado de produção. **Deployment atual de produção:** `READY` no SHA `ae34e89404c2ce55401aadacd37d439deb1a6edc`, após a PR #10. Não foi feito deploy manual.

## Portão 2, download e limpeza

Os drafts Releases privados dos jobs permanecem preservados. **Não executei `render-cleanup.yml`**: a limpeza prevista dependia da aprovação do Portão 2 e do download, e esses passos não ocorreram. Apagar agora removeria as cópias antes de o proprietário decidir se deseja preservá-las para inspeção ou descartá-las.

Estado final atualizado: Portão 1 aprovado; 2 jobs reais já executados; callback/QA rejeitado em ambos; Portão 2 não aprovado; MP4s não baixados; nenhuma publicação no YouTube; um job permanece zumbi; drafts preservados e limpeza pendente. A PR #9 e sua migration já foram aplicadas; a PR #10 foi mesclada e implantada. Qualquer novo render depende de autorização explícita.


## Atualização de diagnóstico — 15/10/2026

O pré-voo foi repetido em leitura: produção está `READY` no SHA `ae34e89404c2ce55401aadacd37d439deb1a6edc` (PR #10), e a branch `main` do Neon contém as colunas de status HTTP da PR #9. A PR #9 e a PR #10 já estão mescladas; esta atualização corrige a orientação antiga da linha 64, que ainda dizia que faltavam merge e migration. Não fiz deploy manual nem alterei segredos.

A prova já consumiu **dois jobs reais** — dentro do limite de até três jobs da autorização original — e nenhum foi iniciado nesta retomada. O segundo job é `45561bca-728c-4336-9fb3-6251b3d2cac9`, Actions run [#38803195208](https://github.com/jadiel054/estudio-canal-ia/actions/runs/38803195208), executado no SHA de produção. O run durou **2 min 01 s** (20:35:32–20:37:33 UTC); o runner, **1 min 58 s**. Seu evento TTS `render` foi `api_call/success`, HTTP 200, em 20:36:28.134 UTC. O job terminou `failed` em 90%, com `http_status=400` e `error_code=callback_release_verification_failed`. Isso confirma que a falha ficou concentrada na verificação do Release, mas ainda não identifica qual comparação ou chamada a causou.

O estado persistido do job não contém checks de QA: `qa` é um array vazio, tanto no registro relacional quanto no estado da aplicação. Portanto, nenhum dos cinco checks (`video_stream`, `audio_stream`, `captions`, `duration`, `file_size`) pode ser marcado como aprovado, e o Portão 2 continua bloqueado. Não baixei nem aprovei o vídeo. A tentativa de logs Vercel dentro da janela recente não encontrou eventos com o filtro usado; a consulta mais ampla de uma hora foi recusada pela retenção do plano. Isso não prova ausência absoluta de logs.

O draft privado `414250569` foi confirmado como `draft=true` e contém dois assets enviados: um MP4 de **2.518.214 bytes** e um SRT de **1.293 bytes**. O Release anterior `414172008` também permanece conforme o registro da prova. Não baixei nem removi nenhum deles; não executei `render-cleanup.yml` e não publiquei no YouTube.

A PR #10 já estava no deployment deste segundo job, mas seu código ainda registra a verificação de Release como uma única etapa. Por isso, o `callback_release_verification_failed` atual não pode discriminar consulta HTTP, resposta JSON, estado do draft ou metadados do asset. Para instrumentar esses ramos sem relaxar a validação, foi aberta a **[PR #11 — Detalhar diagnóstico seguro da verificação de Release](https://github.com/jadiel054/estudio-canal-ia/pull/11)**. Ela usa apenas `stageCode` allowlisted, mantém o requisito de draft e as comparações exatas e não inclui mensagens da API, payloads, tokens ou conteúdo editorial nos logs. Está aberta, sem merge. Validação final: `pnpm test` (23 arquivos, 138 testes), `pnpm check`, `python3 -m unittest discover -s scripts -p 'test_render_video.py'` (18 testes) e `pnpm build` passaram. Os checks da PR no GitHub também estão aprovados. O build manteve os avisos preexistentes sobre `config.js` e tamanho do bundle.

### SQL manual opcional para encerrar o job zumbi

A coluna `status` de `studio_render_jobs` é `TEXT` com `CHECK`, não um tipo ENUM PostgreSQL. Os valores permitidos incluem `queued`, `rendering`, `qa`, `succeeded`, `failed` e `cancelled`; logo, `failed` é válido. O SQL abaixo **não foi executado**. Ele altera somente a linha relacional do job e só a atualiza se ainda estiver em `rendering` a 88% no run esperado. Use-o apenas se decidir encerrar manualmente o zumbi:

```sql
BEGIN;

UPDATE public.studio_render_jobs
SET status = 'failed',
    error_code = 'callback_operation_failed',
    error_message = 'Callback QA falhou; causa não determinada (HTTP 400).',
    finished_at = COALESCE(finished_at, NOW()),
    updated_at = NOW()
WHERE id = 'eb74bf31-8df1-4311-9766-c601976d4119'::uuid
  AND status = 'rendering'
  AND progress = 88
  AND workflow_run_id = 38790905182
RETURNING id, status, progress, error_code, http_status, finished_at;

COMMIT;
```

Confirme que o `UPDATE` retornou exatamente uma linha. Se retornar zero, não remova as condições: confira o estado atual antes de decidir outro ajuste. Este SQL atualiza a tabela de jobs, não o espelho JSON em `app_settings`; a interface pode continuar exibindo o estado antigo até que esse espelho seja sincronizado por um caminho apropriado.

**Estado operacional nesta atualização:** dois jobs consumidos; job #1 em `rendering`/88% até eventual decisão manual; job #2 `failed`/90%; ambos os drafts privados mantidos; Portão 2 não aprovado; nenhum download, publicação, limpeza, merge ou novo render realizado nesta retomada. A PR #11 permanece aberta para revisão; a próxima execução de render continua dependente de autorização explícita e de confirmação do merge dessa PR quando o usuário decidir avançar.
