# Prova ponta a ponta da Fase 1 — resultado

**Estado: PAUSADA antes de criar conteúdo ou iniciar chamadas de produção.** A autorização explícita foi respeitada dentro do limite solicitado: ao encontrar um bug que impediria a verificação do cache, a prova foi interrompida, sem iniciar pauta, roteiro, amostra TTS ou render. Foi preparada uma correção em branch separada; ela será submetida em PR sem merge e sem deploy.

**Data da verificação:** 15/10/2026 (horário de São Paulo, UTC−03).

## Pré-voo

| Verificação | Resultado | Evidência |
|---|---|---|
| PR #4 — contrato REST do Gemini TTS | OK, mesclado | Merge commit `1056d42f615a28b5b5f2cb2771224e587f85f093`. |
| PR #7 — batching/cache/quota | OK, mesclado | Merge commit/HEAD de `main`: `68e3b5303796ec9106faf4058763b12c4f1b1d26`. |
| Produção Vercel em `main` | OK | Deployment `dpl_DfbcebMMjt24SnUk5SiLWwN2RKrq`, estado `READY`, alvo `production`, SHA idêntico ao HEAD de `main`; alias `https://estudio-canal-ia.vercel.app`. O deployment ficou pronto cerca de 60,4 s após o início do build. |
| Migração Neon do PR #7 | OK | A migration foi aplicada e verificada anteriormente na branch principal. Nesta verificação, a tabela de uso respondeu à consulta e o cache não tinha entradas válidas. |
| Contadores TTS antes da prova | OK — baseline zero | Janela diária `America/Los_Angeles`: 0 eventos, 0 chamadas API, 0 sucessos, 0 falhas, 0 cache hits; 0 entradas de cache válidas. |

## Etapas autorizadas

| Etapa | Estado | Resultado/evidência |
|---|---|---|
| 1. Pré-voo | **OK** | Produção está no HEAD de `main`; PRs #4 e #7 mesclados; migration acessível e contadores iniciais zerados. |
| 2. Criar pauta, gerar roteiro e aprovar no Portão 1 | **NÃO EXECUTADA** | Nenhuma pauta ou roteiro de prova foi criado; Portão 1 não foi acionado. |
| 3. Gerar a mesma amostra TTS duas vezes e testar cache | **BLOQUEADA / NÃO EXECUTADA** | A rota de produção `tts.test` chamava `generateSpeech`, que ignora o cache. Duas execuções não provariam um cache hit e poderiam gerar chamadas Gemini adicionais. A consulta posterior confirmou que nenhum evento TTS foi registrado durante esta prova: contadores permanecem em zero. |
| 4. Captura simples | **NÃO EXECUTADA** | Opcional; nenhum item visual foi anexado. |
| 5. Iniciar e acompanhar render real | **NÃO EXECUTADA** | Nenhum job de render desta prova foi criado; nenhuma execução nova de GitHub Actions foi disparada. Duração do job Actions: **N/A — workflow não iniciado**. Contagem de cues/blocos: **N/A — roteiro não criado**. |
| 6. Aprovar no Portão 2 e baixar MP4 | **NÃO EXECUTADA** | Nenhum vídeo foi renderizado/aprovado; tamanho do MP4 e QA item a item: **N/A**. Nada foi publicado no YouTube. |
| 7. Limpar draft Release | **NÃO APLICÁVEL** | Nenhum job nem draft Release foi criado; o workflow `render-cleanup.yml` não foi acionado. |
| 8. Registrar diagnóstico | **OK** | Este relatório registra o estado, a causa e as evidências sem conteúdo editorial ou segredos. |

## Desvio encontrado e correção preparada

A tela “Gerar amostra” usa a mutation `tts.test`. No código presente em produção, essa rota chamava `generateSpeech(...)`, não `generateSpeechCached(...)`. Além de contornar o cache persistente do Neon, a chamada era registrada com a finalidade padrão `render`, dificultando distinguir uma amostra de uma narração de render.

A correção preparada em branch separada faz a rota usar `generateSpeechCached(...)` com finalidade `connection_test`, propaga essa finalidade para os eventos de API e `cache_hit`, e inclui regressões que verificam que a repetição da frase fixa reaproveita o WAV, não faz uma segunda chamada Gemini e grava corretamente `connection_test`. O limitador atual da amostra permanece ativo: permite uma tentativa por minuto; após a correção estar mesclada e implantada, a repetição de produção deverá respeitar esse intervalo.

**Validação local da correção:** `pnpm check` OK; `pnpm test` — 21 arquivos e 106 testes OK; `python3 -m unittest scripts.test_render_video` — 17 testes OK; `pnpm build` OK. O build exibiu avisos preexistentes sobre `config.js` não modular e chunk JS acima de 500 kB; não falhou.

## Estado final observado

A aplicação de produção não foi aberta nem alterada durante a prova; não existe pauta, roteiro, job de render ou draft Release criado por esta execução. Não houve chamada real ao Gemini TTS, render, aprovação de Portão 1/2, download de MP4, publicação, execução de limpeza, merge ou deploy. As duas aprovações humanas e o restante da prova ficam pendentes até a correção estar mesclada e publicada pelo fluxo autorizado.

## Evidências que não existem porque a prova foi interrompida

- 1ª versus 2ª amostra TTS / cache hit: não executadas; baseline e contadores seguem 0.
- Número de cues/blocos: indisponível, pois o roteiro de prova não foi criado.
- Duração do workflow de render: indisponível, pois não foi iniciado.
- QA do MP4 e tamanho do arquivo: indisponíveis, pois nenhum MP4 foi produzido.
- Captura do estado final dentro do app: não capturada; estado final descrito acima.
- Logs do job desta prova: inexistentes; nenhum job foi enviado.
