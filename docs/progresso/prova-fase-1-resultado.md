# Prova ponta a ponta da Fase 1 — resultado

**Resultado: FALHA PARCIAL.** A amostra TTS comprovou o cache; a pauta, o roteiro, o Portão 1 e um único render real foram executados. O MP4 foi criado e enviado a um draft Release privado, mas o callback final de QA recebeu HTTP 400. O job não chegou ao Portão 2, não foi baixado nem publicado. Não houve nova tentativa.

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

A correção de schema e seu teste estão na [PR #9](https://github.com/jadiel054/estudio-canal-ia/pull/9), aberta e sem merge. A migration está no PR e **não foi aplicada** no Neon. Os testes locais passaram: `pnpm check`; `pnpm test` (21 arquivos, 107 testes); `python3 -m unittest scripts.test_render_video` (17 testes); e `pnpm build`. O build mantém avisos preexistentes sobre `config.js` e tamanho de bundle.

A integração criou automaticamente o preview Vercel [READY](https://estudio-canal-3bn08e9vq-jadiels-projects-3b6be146.vercel.app), separado de produção. O deployment de produção continua `READY` no SHA `4324e3d2ef50606c839a7db273d7172a9e7451bb`. Não fiz deploy manual nem merge.

## Portão 2, download e limpeza

O draft Release privado ainda contém o único MP4 produzido. **Não executei `render-cleanup.yml`**: a etapa autorizada previa limpeza depois da aprovação do Portão 2 e do download, e esses passos não ocorreram. Apagar agora removeria a única cópia antes de o proprietário decidir se deseja preservá-la para inspeção ou descartá-la.

Estado final: Portão 1 aprovado; 1 render real criado; callback/QA rejeitado; Portão 2 não aprovado; MP4 não baixado; nenhuma publicação no YouTube; 0 retries; limpeza pendente da decisão do proprietário. Para retomar, primeiro revisar/mesclar a PR #9 e aplicar sua migration pelo fluxo autorizado; qualquer novo render fica fora desta prova e requer autorização própria.
