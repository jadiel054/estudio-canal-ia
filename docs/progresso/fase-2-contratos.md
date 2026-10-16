# PR-00 — Blueprint e contratos da Fase 2

**Status:** documentação para revisão do dono. Este arquivo fixa contratos propostos a partir do blueprint e do código atualmente no `main`; não implementa esses contratos nem aplica migration. Nenhuma query foi executada no Neon e nenhum deployment foi consultado nesta PR.

- [Blueprint original](../blueprint-canal-youtube.md)
- [Plano geral da Fase 2](fase-2-plano.md)
- [Referências visuais preservadas](../referencias-visuais/README.md)

## 1. Escopo orientador do blueprint

O blueprint confirma um painel pessoal, de operador humano único, mobile-first, PT-BR e semi-autônomo, com dois portões humanos, demonstrações reais, conteúdo original, adaptadores trocáveis e custo zero na validação inicial. Esse contrato não autoriza gastar, renderizar, publicar ou alterar produção.

Para esta sequência de trabalho:

- Item 1 começa com conexão YouTube **read-only**, sem `youtube.upload` e sem endpoint de escrita.
- Shorts são derivados independentes, passam por Portão 1 e Portão 2 próprios, e **não são publicados nem agendados automaticamente**. O blueprint descreve publicação/agendamento como capacidade futura do módulo Publicação; a Fase 2 documentada aqui não implementa essa capacidade.
- A publicação inicial continua manual. A aprovação do Longo não aprova nem publica os filhos.
- O Item 4 pode usar geração de imagem somente se houver uma opção com quota/custo zero efetivo para a validação, licença e termos aprovados. Sem isso, o recurso fica desligado e o render usa capturas/foco existente. Nenhum valor estimado neste plano é autorização de gasto.
- Frequências semanais e metas de 30 dias do blueprint são parâmetros-alvo ajustáveis, não execução agendada já autorizada.

## 2. Resposta: reconciliação de `studio_*` e `database/neon-schema.sql`

### Fatos do repositório

1. [`database/neon-schema.sql`](../../database/neon-schema.sql) é um schema inicial de domínio, descrito no próprio arquivo como aplicado inicialmente em 2026-10-13. Cria entidades genéricas (`channels`, `ideas`, `scripts`, `assets`, `videos`, `render_jobs`, `reviews`, `publications`, `analytics_snapshots`, `adapters`, `quota_log`, `audit_log`, `app_settings` e outras).
2. [`database/render-pipeline-migration.sql`](../../database/render-pipeline-migration.sql) acrescenta um segundo conjunto de tabelas operacionais (`studio_render_jobs`, `studio_render_inputs`, `studio_render_assets`, hashes de manifesto e eventos de callback). Não altera as tabelas genéricas. Os IDs/colunas também divergem: por exemplo, `render_jobs.id` é `BIGSERIAL` e `video_id` referencia `videos`; `studio_render_jobs.id` é UUID e os IDs de vídeo/ideia/roteiro são `TEXT`. As tabelas `studio_*` não têm FKs para as tabelas de domínio genéricas.
3. [`database/tts-cache-usage-migration.sql`](../../database/tts-cache-usage-migration.sql) amplia `studio_render_jobs` e cria cache/uso TTS. [`database/render-callback-status-migration.sql`](../../database/render-callback-status-migration.sql) também amplia `studio_render_jobs` com status HTTP.
4. O pipeline atual cria e atualiza jobs reais em `studio_render_jobs`, registra eventos idempotentes em `studio_render_callback_events` e, na mesma transação, atualiza o espelho editorial em `app_settings.value` para a chave `studio_state`. A montagem do manifesto e os assets de entrada consultam essas estruturas. Veja [`server/renderPipeline.ts`](../../server/renderPipeline.ts).
5. [`server/studioRepository.ts`](../../server/studioRepository.ts) ainda implementa `getStudioQueueSummary()` consultando `render_jobs` genérico. Isso **não** é um espelho garantido de `studio_render_jobs`; há risco de a contagem de jobs reais exibida por essa consulta divergir. O fluxo de render não faz dual-write para a tabela genérica.
6. O repositório contém SQLs separados, idempotentes, mas não há um manifest/runner/ledger de migrations identificado. Comentários e relatórios antigos registram aplicações históricas, mas não foram executadas queries de leitura no banco nesta PR; portanto, este texto não afirma o estado atual de cada migration em produção.

### Decisão de contrato

- `neon-schema.sql` permanece como **bootstrap do domínio-base**, não como inventário completo do schema atual.
- `studio_render_jobs` e tabelas operacionais associadas são a fonte relacional de verdade para o estado detalhado dos jobs reais. `studio_render_callback_events` é o registro idempotente de callbacks.
- Enquanto a migração completa do domínio não for planejada e aprovada, `app_settings.studio_state` continua sendo a fonte de verdade do estado editorial consumido pelo app. O pipeline mantém a atualização do job e do espelho editorial na mesma transação, com verificação de versão.
- `render_jobs` genérico é legado/projeção não sincronizada; fica preservado, sem drop, rename, backfill ou dual-write automático. Uma PR posterior deverá trocar `getStudioQueueSummary()` para a fonte operacional ou criar uma view explicitamente testada. Não confiar na contagem genérica como métrica dos jobs reais até essa correção.
- Para novos ambientes, a ordem conceitual é: bootstrap `neon-schema.sql`; migrations aditivas versionadas; `render-pipeline` antes das migrations que alteram `studio_render_jobs`; `radar` é independente. A ordem relativa entre callback e TTS pode ser definida no ledger, pois ambas dependem da tabela-base de render. O deploy não deve aplicar DDL implicitamente.
- A próxima etapa de infraestrutura deverá introduzir um ledger de migrations e uma reconciliação por ambiente, ou documentar explicitamente o runner aprovado. Antes de qualquer alteração/execução em Neon, confirmar em leitura o schema aplicado e preparar plano de compatibilidade/backfill. Essa confirmação é uma ação separada e não foi feita nesta PR.
- Não adicionar colunas de `sectionIndex` a `studio_render_inputs` sem necessidade: o código atual guarda essa atribuição no asset JSONB e a projeta no manifesto. Se a Fase 2 exigir consulta/relatório relacional sobre essa atribuição, propor migration específica e tratar versionamento/backfill separadamente.

**Consequência pendente, não implementada:** corrigir a fonte de `getStudioQueueSummary()` em PR separada, sem apagar `render_jobs` e sem aplicar SQL neste documento.

## 3. Resposta: marcador `Nota de produção`

### Sintaxe escolhida

Reconhecer linha isolada com ou sem negrito Markdown, sem diferenciar maiúsculas/minúsculas, por exemplo:

```text
**Nota de produção:** Não exibir credenciais no exemplo.
```

A sintaxe pode ter texto na mesma linha ou continuação nas linhas seguintes. O bloco termina em linha em branco, próximo marcador reconhecido (`Visual:`, `Áudio (Narração):` ou `Nota de produção:`), título de seção Markdown ou abertura de bloco de código. A nota fica vinculada ao `sectionIndex` em que aparece. Limite proposto: 2.000 caracteres por nota e no máximo 80 direções/notas por roteiro, coerente com limites do manifesto.

### Semântica

- A primeira ocorrência de qualquer um dos três marcadores ativa o **modo marcado** para o roteiro inteiro.
- `Áudio (Narração)` é o único conteúdo desses blocos que pode virar cue, TTS, legenda ou texto falado do slide.
- `Visual` é metadata visual por seção: nunca vira fala, legenda nem texto de slide. Pode guiar seleção de captura/foco e, quando habilitado por policy, composição visual; não é prova factual.
- `Nota de produção` é metadata interna de edição/QA. Aparece no editor e nas mensagens de lint para o operador, mas não entra em `cues`, TTS, SRT/ASS, texto de slide, chamada a provider visual, worker manifest, logs, audit details ou analytics. Uma ação visual específica deve ser escrita como `Visual:`; a nota não é um canal genérico para instruções automáticas.
- Bloco apenas com Visual/Nota, sem nenhuma fala válida, não constitui roteiro renderizável.
- Sem qualquer marcador reconhecido, preserva-se o comportamento legado: texto fora de títulos/blocos de código é narração.
- Em modo marcado, nenhum parágrafo solto é convertido silenciosamente em fala. A implementação deverá apresentar lint bloqueante; não haverá fallback de QA para o texto bruto.
- Marcadores dentro de blocos de código são texto de código e não ativam modo marcado.

A forma do parser atual (`server/renderManifest.ts`) reconhece apenas Visual/Áudio e não expõe diagnóstico de parágrafo solto ou Nota. Este contrato é para a PR futura do parser/lint; a PR-00 não muda o parser.

## 4. Resposta: severidades do lint

O lint é determinístico e executado localmente no servidor; não depende de LLM. Cada diagnóstico tem `code` estável, `severity`, `sectionIndex`, linhas inicial/final e mensagem PT-BR. O texto integral do trecho pode aparecer apenas na UI/editor autenticada; logs e telemetria usam somente código e contagens.

| Severidade | Efeito | Exemplos contratuais |
|---|---|---|
| `error` (bloqueante) | Bloqueia Portão 1 e impede render até correção. Não existe opção de continuar com fallback bruto. | Parágrafo solto antes/entre/depois dos blocos em modo marcado; roteiro marcado sem nenhum cue de áudio; marcador conhecido sem conteúdo ao fechar o bloco; bloco/cue/nota acima do limite; `sectionIndex` inválido; cue vazio ou texto que não pode ser limitado com segurança. |
| `warning` (não bloqueante) | Mostra explicação e fallback esperado; operador ainda pode aprovar. | Seção falada sem direção Visual (usa focus frame); direção Visual sem captura atribuída (usa focus frame); nota de produção presente mas não acionável/sem tipo reconhecido; código de exemplo não associado a uma seção. |
| `info` (não bloqueante) | Transparência, sem necessidade de ação. | Roteiro sem marcadores usando modo legado; quantidade de cues/direções/notas e fallback visual selecionado. |

A UI deve rotular os três níveis por cor, ícone e texto (não apenas cor). O QA de conteúdo não pode rebaixar `error` para `warning`, apagar o diagnóstico ou recuperar narração de `content` bruto. O usuário pode editar, rerodar o lint e então aprovar o texto corrigido.

## 5. Resposta: contrato do worker (aspect, motion, foco e QA)

### Manifesto e compatibilidade

O contrato atual do manifesto em `server/renderPipeline.ts` inclui `format`, `sections`, cues, `visualDirections`, code blocks e `inputs[]` com hash/tipo/tamanho/`sectionIndex`. O worker busca os bytes por endpoint autenticado, verifica SHA-256 e tamanho. A próxima implementação deve versionar o contrato (`workerContractVersion`/versão equivalente) e fazer rollout API-compatível antes de exigir novos checks; a PR-00 não altera payloads.

### Aspect ratio e composição

| Formato | Resolução de saída | Codec atual/esperado |
|---|---|---|
| Longo | 1280×720 (16:9) | H.264, 30 fps, `yuv420p`; áudio AAC 160 kb/s; `+faststart` |
| Short | 1080×1920 (9:16) | H.264, 30 fps, `yuv420p`; áudio AAC 160 kb/s; `+faststart`; duração máxima interna 180 s |

Capturas de UI/código devem usar `contain`, preservando a tela completa e proporção; não cortar barra de endereço, menu, output, credenciais ou bordas que indiquem contexto. Recorte/crop só é permitido para fundo abstrato sem texto, com safe area reservada. Legendas devem respeitar a área segura e não cobrir conteúdo essencial; nenhuma imagem substitui a demonstração real de código/tela exigida pelo blueprint.

O worker atual já usa 1280×720 para não-Short e 1080×1920 para Short, 30 fps, H.264/yuv420p, AAC e `faststart`; as capturas são ajustadas por `ImageOps.contain`. A validação automática atual checa resolução/codec, mas não cobre por completo FPS, safe areas ou cortes visuais.

### Movimento

O worker atual cria quadros estáticos, sem motion. O contrato futuro é **motion determinístico de composição**, não geração de vídeo:

- Capturas reais de plataforma/código permanecem estáticas por padrão, para preservar legibilidade e contexto.
- Em arte abstrata/gerada sem texto, preset opcional Ken Burns: escala linear/eased de 1,00× a no máximo 1,06× por segmento; pan total no máximo 3% de largura/altura normalizadas; sem shake, saltos, loops ou interpolação aleatória.
- `motionPreset=none` é fallback obrigatório e default quando manifest/policy não autorizam movimento. O preset fica versionado, determinístico e coberto por teste frame-a-frame.
- O crop de motion deve preservar safe areas e não deslocar/ocultar legenda, rosto ou conteúdo de UI. Se a safe area não puder ser garantida, o worker usa `none`.

### Foco, seções e capturas

- `sectionIndex` é zero-based e indexa `sections[]`; este é o vínculo canônico. O nome da seção é apenas rótulo. Se nomes duplicados existirem, não usar nome como chave.
- Cada cue e direção Visual deve carregar o mesmo `sectionIndex`; direção Visual explícita prevalece sobre índice legado do cue. O worker atual procura direção pelo nome antes de conferir índice; a implementação futura deve corrigir para resolver pelo índice primeiro.
- Captura atribuída a uma seção só aparece nessa seção, no primeiro cue daquela seção; múltiplas capturas podem formar composição sem crop indevido. Captura genérica (`sectionIndex=null`) aparece no máximo no primeiro cue do vídeo, não se repete como fundo estático para o restante.
- Sem captura compatível, usar o focus frame atual: seção/cue em destaque, fundo coerente com o preset, fala do cue; nunca exibir Nota de produção. A direção Visual afeta apenas a seleção/composição, nunca vira texto apresentado.
- Até cinco inputs por versão, cada arquivo de até 2 MiB e 8 MiB combinados, formatos PNG/JPEG/WebP e hash/tamanho conferidos são limites já implementados. O vínculo de seção atual fica em `state.assets` e é projetado no manifesto; a tabela de input binário não contém essa coluna.

### QA e gates

O callback atual exige checks verificados `video_stream`, `audio_stream`, `captions`, `duration` e `file_size`. O worker já verifica stream H.264/AAC, dimensões, duração (Short ≤180 s; hard cap geral 7.200 s), SRT não vazio e tamanho dentro dos limites. A geração ASS atual fixa `PlayResX/PlayResY`, define fonte a 3,8% da largura e agrupa no máximo duas linhas por evento, com até sete palavras por linha e duração proporcional quando divide cue longo.

Limite importante: o QA existente não prova que a Nota foi excluída de toda representação, não audita visualmente foco/safe area e não mede FPS. A verificação do SRT confirma estrutura básica, não legibilidade visual. Portão 2 humano continua obrigatório.

Na versão futura do contrato, manter as cinco labels para compatibilidade e acrescentar, sob versão 2 do worker, checks estruturados para:

1. `video_stream`: resolução, aspect, codec, pixel format e FPS reais via `ffprobe`.
2. `captions`: arquivo/subtitles presentes, `PlayRes` igual à saída, fonte dentro do limite, cada evento com no máximo duas linhas, largura segura e cue timing sem lacunas/sobreposição inesperadas.
3. `visual_layout`: índices válidos, associação seção→captura, foco quando faltar captura, movimento dentro do preset e safe areas.
4. `production_notes_excluded`: nenhuma Nota presente em manifest narrável, TTS, SRT/ASS ou texto de slide.
5. `audio_stream`, `duration` e `file_size`: manter checks atuais, medidos do MP4 final.

O rollout deve primeiro fazer o servidor aceitar versão atual e futura; só então o worker passa a enviar o conjunto versionado. QA automatizado não declara copyright/licença, veracidade factual, ausência de PII ou qualidade editorial subjetiva: esses itens permanecem como checklist e decisão humana no Portão 2. Qualquer falha de QA mantém o Portão 2 bloqueado.

## 6. Referências visuais e uso

As duas imagens enviadas pelo dono foram preservadas sem reprocessamento em [`docs/referencias-visuais/`](../referencias-visuais/). São referências de composição, não assets liberados para uso nos vídeos, evidência de capacidade ou prova de licença. A segunda contém interface de terceiro e identificador de perfil visível; o repositório GitHub está público. A inclusão foi feita a pedido do dono e fica registrada para que futuras iterações não confundam referência estilística com conteúdo livre para redistribuição.

## 7. Itens que permanecem abertos após este contrato

O blueprint resolve as perguntas contratuais acima; não resolve decisões de implementação que exigem prova operacional ou escolha de produto: provider/model/revisão visual e licença; política concreta de quota/orçamento; disponibilidade/precisão de scheduler; URI OAuth e verificação Google; combinação autorizada de scopes Analytics/Reporting; migração/runner e schema aplicado por ambiente; atualização da fonte de `getStudioQueueSummary`; critérios de teste visual do motion e política de retenção.

Esses itens devem ser fechados em PRs futuras com testes, sem executar migrations, OAuth, coleta, geração, render, publicação, merge ou deploy sem a autorização correspondente.
