# Redução de chamadas Gemini TTS — pesquisa inicial

**Fontes oficiais consultadas em 14/10/2026:**

- Gemini API Rate Limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini API Troubleshooting: https://ai.google.dev/gemini-api/docs/troubleshooting
- Google RPC `QuotaFailure` e `RetryInfo`: https://developers.google.com/health/reference/rpc/google.rpc

A documentação do Google descreve limites por RPM (requisições/minuto), TPM (tokens/minuto) e RPD (requisições/dia), por projeto; os limites mudam por tier e modelo, e os valores ativos devem ser verificados no AI Studio. O RPD reseta à meia-noite do Pacífico. Portanto não há base suficiente para assumir um valor fixo universal, como “100 chamadas/dia”.

A recomendação oficial é backoff exponencial com jitter e limite máximo de tentativas para erros transitórios. `RetryInfo.retryDelay` comunica o tempo mínimo de espera; `QuotaFailure.Violation` pode informar métrica, id, dimensões, descrição e valor da quota. O código deve registrar apenas os campos estruturados necessários, não a mensagem bruta do provedor, prompt, áudio ou segredo.

## Diagnóstico histórico verificado em 14/10/2026

- O job Neon `70bbf514-eb82-4403-afa0-2d84862a5df9` terminou `failed` com `error_code=tts_unavailable` e resumo sanitizado `operation=voice code=tts_unavailable http=400 upstream=429`; o workflow foi `38432889360`.
- Os logs retidos do GitHub Actions mostram somente o mesmo resumo seguro (`operation=voice`, `tts_unavailable`, HTTP 400/upstream 429). Não foi possível recuperar retroativamente o corpo estruturado do provedor: os logs Vercel do deployment Hobby não são retidos para aquela data (a janela consultada excedeu a retenção de 1 hora). Não se tentou outro render nem se leu conteúdo do corpo de erro.
- Fontes oficiais consultadas: [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini API troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [Gemini API errors](https://ai.google.dev/api/errors). A correção persiste apenas campos estruturados allowlisted (`quotaScope`, `quotaValue`, identificadores e `retryAfterMs`), nunca mensagem bruta, roteiro ou áudio.


## Implementação de batching, quota, cache e retomada — 14/10/2026

### O que mudou
- O manifesto agrupa cues consecutivos em blocos de até 1.100 caracteres, sem perder o mapa cue→chunk. O worker solicita áudio pelo índice do bloco, pausa 1 s entre blocos e mantém legendas separadas por cue.
- O worker mede cada WAV com `ffprobe`, distribui o tempo proporcionalmente ao texto e, quando encontra pausas próximas com FFmpeg `silencedetect`, ajusta as fronteiras das legendas a esses intervalos. Se não detectar silêncio, mantém a aproximação proporcional. O QA identifica explicitamente que o sincronismo TTS é aproximado.
- A camada Gemini lê `QuotaFailure`/`RetryInfo` e o cabeçalho `Retry-After`, registra apenas códigos/identificadores/números allowlisted, usa backoff exponencial com jitter e até três tentativas por modelo. Quota diária não recebe retry; o fallback pode ser consultado uma vez para verificar uma cota separada.
- O cache Neon usa chave SHA-256 derivada de texto, modelo, voz e estilo; áudio expira logicamente após 7 dias e pode ser reutilizado quando o worker retoma blocos já sintetizados. O histórico diário registra metadados de API/cache, sem armazenar narração em logs ou mensagens de erro.
- A interface mostra chamadas, sucessos, falhas e cache hits do dia (janela/reset em America/Los_Angeles), estima chamadas novas e pior caso antes da confirmação do render e oferece “Continuar sem voz (Música + texto)” somente após falha por quota. Essa ação prepara a pauta; não inicia o job.
- O Portão 1 (aprovação do roteiro) e o Portão 2 (aprovação final do vídeo) permanecem humanos. Não foi iniciado render real, aplicado migration ao Neon de produção, publicado deployment ou feito merge.

### Validação local
- `pnpm check`: passou.
- `pnpm test`: 20 arquivos, 104 testes passaram.
- `python3 -m unittest scripts.test_render_video`: 17 testes passaram, incluindo smoke render local do modo TTS com fixture WAV e sem API externa.
- `pnpm build`: build client/server passou. Permaneceram avisos não bloqueantes do script `/api/platform/config.js` não modular e de bundle client acima de 500 kB.
- `git diff --check`: passou.

### Pendente antes de produção
- Aplicar `database/tts-cache-usage-migration.sql` no Neon e confirmar a disponibilidade dos novos contadores/cache. Essa alteração de banco não foi executada nesta tarefa.
- A PR [#7 — Reduzir chamadas do Gemini TTS com cache e quotas](https://github.com/jadiel054/estudio-canal-ia/pull/7) está aberta e não foi mesclada. A revisão e o merge permanecem com o proprietário; o deploy correspondente ainda não foi realizado.
- Após deploy e revisão dos indicadores, aguardar autorização explícita do usuário para um único render Short; nenhum teste real foi disparado nesta implementação.
