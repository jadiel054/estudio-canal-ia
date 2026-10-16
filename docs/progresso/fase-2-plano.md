# Plano de Fase 2

## 0. Status, escopo e governança

- **Fase 1:** o dono a declarou fechada, validada em produção e pronta para a Fase 2. Confirmei que as PRs #16 (entrega MP4) e #17 (parser Visual/Narração) foram mescladas pelo dono; os checks Vercel das PRs constavam como concluídos. Não fiz verificação adicional do deployment de produção nesta retomada.
- **Esta PR-00:** documentação do blueprint, contratos e referências visuais; nenhum código de produto, migration, query Neon, OAuth, render ou ação em produção foi executado. A branch foi criada sobre o `main` atualizado; não fiz merge nem deploy.
- **Blueprint:** recebido e preservado em [docs/blueprint-canal-youtube.md](../blueprint-canal-youtube.md). As respostas de schema, Nota de produção, severidades do lint e contrato do worker estão em [fase-2-contratos.md](fase-2-contratos.md).
- **Aprovação:** este documento deve ser revisado e aprovado pelo dono antes de qualquer código do Item 1, conforme solicitado. Migrations, credenciais, quota, renders com custo e mudanças em produção também continuam sujeitos a autorização própria.
- **Fase 3 paga:** vídeos com movimento orgânico gerado por APIs como Veo/Sora e pós-validação operacional do canal ficam fora da Fase 2. O movimento determinístico de composição (Ken Burns em imagem/captura) pode ser avaliado no Item 4, sem ser tratado como geração de vídeo.

### Estado documental a reconciliar

O `README.md`, o `TODO.md` e `docs/progresso/prova-fase-1-resultado.md` ainda contêm informações antigas que entram em conflito com o estado descrito pelo dono — por exemplo, o relatório da prova mostra estado parcial e jobs anteriores. Este plano adota a atualização explícita do dono como estado corrente da Fase 1. Antes de iniciar implementação, atualizar o relatório histórico para preservar os fatos antigos, mas acrescentar a conclusão final do Job 4 e apontar qual informação substitui o estado operacional anterior. Não apagar o histórico nem alterar jobs/drafts.

As duas imagens do Item 4 foram recebidas e preservadas sem reprocessamento em [docs/referencias-visuais/](../referencias-visuais/). O repositório é público; a nota de proveniência registra que uma captura contém UI/texto de terceiro e identificador visível. As imagens são somente referências de estilo, não assets de vídeo nem prova de licença.

### Legenda de evidência

- **Confirmado:** sustentado por código/documentação disponível ou por fonte oficial citada.
- **Proposta:** desenho recomendado, ainda sujeito à aprovação.
- **Hipótese:** estimativa ou ideia não confirmada; não deve ser tratada como contrato, quota ou licença.
- **Decisão documental PR-00:** contrato registrado para revisão; não altera o comportamento atual até implementação em PR posterior.
- **Bloqueador:** exige resposta/decisão antes de implementar.

## 1. Ordem recomendada

A ordem sugerida pelo dono é mantida, antecedida por um pequeno item de segurança editorial:

1. **Item 4.0 — parser marcado e lint da dívida da PR #17.** Evita perder texto silenciosamente ou converter notas em fala, legenda e duração.
2. **Item 4 — qualidade visual, provider, cache, fallback e motion.** É a prioridade de produto e define contratos usados pelo render e pelos Shorts.
3. **Item 1 — OAuth YouTube read-only.** Cria identidade e credenciais seguras do canal, sem upload.
4. **Item 2 — Analytics e snapshots diários.** Depende de OAuth, canal identificado e semântica de métricas definida.
5. **Item 3 — Fluxo C Longo→Shorts.** Depende dos contratos de roteiro, render, gates, assets e, para o ciclo de aprendizado completo, da modelagem de Analytics.

**Justificativa:** primeiro se estabiliza a gramática dos roteiros e o contrato visual que alimentam o render. Depois vem a conexão de canal sem escrita. Analytics só pode coletar dados próprios após a conexão e o mapeamento de vídeos. Os derivados ficam por último para não multiplicar custos, jobs e gates antes de estabilizar qualidade e controles.

## 2. Item 4.0 — parser marcado e dívida da PR #17

### Comportamento observado

O parser conserva o comportamento legado quando não há marcador. Ao encontrar `Visual:` ou `Áudio (Narração):`, ativa o modo marcado; apenas blocos de áudio viram cues. Um parágrafo separado fora de bloco pode ser ignorado. O teste atual não cobre esse caso: sua linha sem rótulo ainda é continuação do bloco de áudio. `Visual` permanece metadata, não fala. Há ainda um fallback de QA para o texto bruto quando o parser falha, que não deve mascarar erro de marcação nem influenciar a duração.

Referências locais: [parser](../../server/renderManifest.ts), [testes do parser](../../server/renderManifest.test.ts), [QA e geração de roteiro](../../server/scriptPipeline.ts).

### Decisão proposta

Adotar **lint de marcação explícita**, e não promover parágrafos soltos automaticamente a fala.

- Sem marcadores reconhecidos: preservar exatamente o fallback legado.
- Com pelo menos um marcador: o documento inteiro está em modo marcado. Parágrafo separado fora de bloco recebe diagnóstico; não há fallback automático para o modo legado.
- Continuação dentro do bloco rotulado atualmente aberto pode seguir o contrato existente; um novo parágrafo após separador/linha em branco deve ser diagnosticado.
- `Visual` nunca alimenta TTS, captions ou duração. `Nota de produção:` é a terceira diretiva reconhecida: fica apenas no editor/QA, nunca é enviada ao worker/provider nem vira fala, legenda ou texto de slide.
- O lint terá três níveis: `error` bloqueante no Portão 1/render para conteúdo marcado solto, ausência de fala ou diretiva inválida; `warning` para fallback visual/nota não acionável; `info` para modo legado e transparência. O detalhe e os exemplos estão no [contrato da PR-00](fase-2-contratos.md#4-resposta-severidades-do-lint).
- O diagnóstico contém código estável, severidade, seção/linha e trecho curto. A UI mostra ação explícita para rotular como Áudio, Visual/Nota permitida ou remover; logs contêm apenas código/contagens.
- Editor/QA mostra aviso acionável; qualquer `error` bloqueia Portão 1 e render. O rascunho continua disponível para edição.
- A duração é calculada somente a partir de cues válidos; o QA não volta ao conteúdo bruto para contornar erro de marcação.

**Aceite:** legado sem marcadores; parágrafo solto antes, entre e depois dos blocos; marcador dentro de código não ativa o modo; Visual/código não viram fala; documento apenas Visual falha explicitamente; diagnóstico aparece mesmo sem LLM; texto misto não pode ser renderizado.

**Schema:** nenhuma tabela nova é necessária por padrão. Persistência de lint só deve ser proposta após definir histórico, vínculo com script/version e retenção. A gramática detalhada da Nota está no [contrato da PR-00](fase-2-contratos.md#3-resposta-marcador-nota-de-produção).

## 3. Item 4 — estúdio visual: geração opcional, cache e motion

### Escopo funcional proposto

1. Criar um adapter de geração de imagem no servidor. Fixar provider, modelo/revisão, parâmetros e preset em política versionada; não selecionar automaticamente o provider mais rápido.
2. Derivar prompt de `visualDirections` por seção. Gerar no máximo uma imagem por seção com direção válida; não gerar se faltar direção. A direção não vira texto na imagem: palavra-chave e legenda são compostas pelo worker.
3. Reservar quota/budget de forma transacional, consultar cache e só chamar provider se preço, quota e direitos estiverem definidos. Worker FFmpeg recebe o arquivo por endpoint interno assinado; não chama provider externo.
4. Validar MIME, dimensões, tamanho, hash, safety e provenance. Não registrar prompt completo, segredo, conteúdo editorial ou resposta bruta em logs.
5. Fallback obrigatório por seção: **captura real licenciada → imagem gerada cacheada e aprovada → focus frame atual**. Falha de provider, quota, budget, cache ou validação cai para o próximo nível sem retry infinito nem gasto automático.
6. Adicionar Ken Burns sutil em capturas e imagens, com foco por seção e safe area de legenda. Valores iniciais de design propostos: zoom até 1,06 e deslocamento até 3% do quadro; devem ser validados visualmente e não são fatos externos.
7. Registrar `source_kind` (`real_capture`, `generated_image`, `focus_frame`), `synthetic`, provider/model/revisão, prompt hash, seed, dimensões, content hash, termos/licença, moderação e revisão humana. Imagem gerada não é evidência técnica. Captura simulada deve ser identificada como sintética; captura real requer autorização, licença e tratamento de PII.
8. Checklist de QA deve confirmar disclosure sintético aplicável, ausência de PII/marcas/rostos indevidos, texto sobreposto legível e ausência de afirmações factuais falsas.

### Providers, licença e estimativa de custo

O levantamento encontrou candidatos, não uma escolha final. Quotas, preços e termos mudam; qualquer valor abaixo é uma fotografia das páginas oficiais consultadas e deve ser revalidado no momento do piloto.

| Opção | Evidência consultada | Recomendação de planejamento |
|---|---|---|
| Cloudflare Workers AI + `@cf/black-forest-labs/flux-2-klein-4b` | A página oficial informa 10.000 Neurons/dia e preço de 26,05 Neurons / US$0,000287 por tile de saída 512×512. A documentação do provider trata o modelo como serviço de terceiro. | Candidato a piloto, condicionado à licença do modelo exato e aos termos do endpoint. “Grátis” significa apenas dentro da alocação diária e não garante disponibilidade sustentável. |
| Hugging Face Inference Providers | A página oficial consultada diz que Free User não tem créditos mensais incluídos; uso é pay-as-you-go, com créditos ligados a planos/compra. | Não apresentar como gratuito. Pode ser adapter de portabilidade; fixar provider/model/revisão e validar preço/limites. |
| Google Gemini image | Os modelos consultados não tinham Free Tier; a página de preços informava US$0,0336 por imagem 1K (Nano Banana 2.1) e US$0,067 (Gemini 3.1 Flash Image). | Alternativa paga, não gratuita. Não enviar capturas confidenciais até aprovação do tratamento de dados e dos termos. |
| Replicate | Cobrança por tempo de computação; limites, cold boot e licença dependem do modelo. Uso sem billing pode ser temporário. | Alternativa operacional, não pressupor free tier sustentável ou preço universal. |

**Estimativa Cloudflare — proposta, não garantia:** oito imagens 1024×1024 × quatro tiles de saída de 512×512 = aproximadamente 833,6 Neurons e US$0,0092 à tarifa consultada acima da alocação gratuita. Cálculo exclui plano, egress, storage, retries e arredondamentos. Dentro da quota gratuita disponível, a cobrança de inferência pode ser US$0, mas a quota é compartilhada e finita. Para comparação, oito imagens 1K no Gemini seriam aproximadamente US$0,2688 ou US$0,536 nos preços consultados, antes de outros custos.

**Controles propostos, aguardando aprovação:** até 8 imagens geradas por vídeo por padrão; hard limit 12; até duas tentativas por cache key; budget interno de US$0,50 por vídeo; bloqueio quando custo/quota/licença não puderem ser determinados. Esses números são guardrails iniciais, não permissões de gasto. Geração orgânica de vídeo fica na Fase 3 paga.

**Licença:** a licença Apache 2.0 do model card FLUX.2 klein 4B é evidência relevante para o modelo, mas não prova por si só direitos sobre a saída nem substitui os termos do endpoint/provider, a revisão de marcas/capturas ou a análise jurídica. Provider/model/revisão e licença comercial devem ser confirmados antes de habilitar geração. Se algum direito estiver incerto, o provider fica bloqueado e o fallback continua disponível.

### Tabelas/migrations propostas, não executadas

- `studio_image_cache`: cache key SHA-256, provider/model/revisão, prompt hash, preset/versão, parâmetros permitidos, dimensões, formato, bytes ou URI privada, content hash, expiração inicial proposta de sete dias e hit count. Limite rígido de bytes e sem prompt bruto/segredo por padrão.
- `studio_image_usage`: geração, cache hit, bloqueio por quota/budget, falha do provider e fallback; job/video/seção, provider/model, status HTTP, quota, retry-after, custos estimado/confirmado, cache key e timestamp; sem conteúdo editorial ou PII.
- `studio_generated_visuals` ou extensão formal de `assets`: job/video/script/version, section index, cue range, source kind, synthetic, provider/model/revisão, seed, dimensões, crop/foco, content hash, URL dos termos/licença, C2PA quando disponível, moderação e revisão.
- Extensão do job para snapshot de política/custos visuais, sem sobrescrever campos que hoje pertençam ao TTS.
- Reutilizar `adapters` para a capacidade `image_generation` e `rate_limit_state` para single-flight; uso/custo precisa permanecer auditável.
- Manifesto assinado deve conter somente descriptors seguros (asset id, seção, origem, endpoint assinado, hash, dimensões e foco), nunca prompt/segredo.

**Contrato de schema definido para revisão na PR-00:** `neon-schema.sql` é bootstrap do domínio; `studio_render_*`/`studio_tts_*` são tabelas operacionais adicionadas por migrations. O pipeline real usa `studio_render_jobs`, mas `getStudioQueueSummary()` ainda consulta `render_jobs` genérico; não há dual-write. Preservar ambos até uma PR separada corrigir a leitura e existir ledger/reconciliação por ambiente. Nenhuma migration/consulta em produção foi executada. Ver [reconciliação detalhada](fase-2-contratos.md#2-resposta-reconciliação-de-studio-e-database-neon-schemasql).

Fontes oficiais: [Cloudflare AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [limits](https://developers.cloudflare.com/workers-ai/platform/limits/), [modelo FLUX.2 klein](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/), [data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/), [Hugging Face pricing](https://huggingface.co/docs/inference-providers/pricing), [model card FLUX.2 klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) e [Replicate billing](https://replicate.com/docs/topics/billing).

## 4. Item 1 — OAuth YouTube somente leitura

### Escopo

Conectar canal pela tela Integrações usando o botão existente **Preparar conexão**, iniciar com o scope `https://www.googleapis.com/auth/youtube.readonly`, permitir leitura básica, status sanitizado e desconexão/revogação. Sem `youtube.upload`, endpoints de escrita, upload ou publicação.

**Fato do projeto:** o botão atualmente chama `requestPlatformConnection`, que só altera estado local/auditoria/toast; a copy de escopos cita `youtube.upload` junto com `youtube.readonly`. A implementação futura deve trocar essa copy e usar OAuth real server-side. Consulte [Workspace.tsx](../../client/src/pages/Workspace.tsx) e [StudioStore.tsx](../../client/src/store/StudioStore.tsx).

### Fluxo proposto

1. Usuário autenticado inicia o fluxo; servidor cria `state` aleatório, de uso único, com TTL e vínculo a owner/workspace.
2. Servidor redireciona para Google com URI HTTPS exatamente igual à URI cadastrada no cliente OAuth.
3. Callback valida `state` antes da troca do code; segredo de cliente fica somente no servidor. Usar `access_type=offline` se refresh for necessário.
4. Servidor valida os scopes concedidos, chama `channels.list(mine=true)`, trata zero/múltiplos canais e apresenta escolha conforme política do blueprint. Tokens nunca chegam ao browser.
5. Cifrar refresh token no servidor com AEAD e chave em segredo do ambiente; access token preferencialmente curto/cache/memória. Renovação concorrente usa lock; `invalid_grant` sinaliza reconexão.
6. Desconexão/revogação deve ser idempotente, remover material local conforme política e gerar auditoria redigida.
7. UI consulta status sanitizado e não salva tokens em localStorage/StudioStore.

O catálogo oficial diferencia `youtube.readonly` de `yt-analytics.readonly`. Analytics não deve ser assumido pelo consentimento inicial. A documentação vigente de `reports.query` apresenta um aviso sobre `youtube.readonly`; antes do Item 2, testar os escopos autorizados no método e endpoint escolhidos. Não adicionar escopo mais amplo sem necessidade.

### Tabelas/migrations propostas, não executadas

- Evoluir `channels` com owner/workspace, timestamps de conexão/sincronização, revogação/erro e unicidade por owner/workspace + plataforma + external channel id.
- `youtube_oauth_credentials`: owner/workspace, channel FK, scopes normalizados, ciphertext/IV/tag, key version, expires/updated/revoked timestamps. Client secret nunca no banco.
- Guardar `state_hash`, TTL e consumo único na sessão server-side existente; se ela não existir, propor `oauth_connection_states` com owner/workspace, provider, state hash, redirect URI e timestamps. Nunca guardar state bruto.
- Reutilizar `audit_log` e, se adequado após blueprint, `rate_limit_state`.

### Critérios de aceite

Cobrir state ausente/reutilizado/incorreto, redirect mismatch, code reutilizado, scopes negados/parciais, zero/múltiplos canais, token expirado/`invalid_grant`, revogação, isolamento de usuários e logs sem segredo. Testar que não existe caminho de upload/escrita. Checklist Google e revisão do dono antes de produção.

Fontes: [Google OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes), [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies), [YouTube server-side OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps) e [channels.list](https://developers.google.com/youtube/v3/docs/channels/list).

## 5. Item 2 — Analytics, snapshots diários e Radar

### Contrato de métricas e coleta

- Grão canônico proposto: um fato por canal próprio + YouTube `video_id` + data da fonte; métricas diárias, não acumuladas.
- Views: `views`.
- Retenção: rotular explicitamente como `averageViewPercentage`, com `averageViewDuration` como apoio. Curva detalhada é trabalho posterior e requer consulta por vídeo.
- Inscritos: guardar `subscribersGained` e `subscribersLost` separadamente; líquido é derivado. Não inferir causalidade total do canal a partir da atribuição por vídeo.
- CTR: chamar de **CTR de thumbnail** e obter de YouTube Reporting `channel_reach_basic_a1` com `video_thumbnail_impressions` e `video_thumbnail_impressions_ctr`. Se Reporting não for aprovado/disponível, mostrar `null`/indisponível; não substituir por CTR de card/anotação.
- Analytics targeted query permite `day` e `video`, filtro em lotes até 500 IDs, mas combinações de dimensões/métricas são limitadas e podem rejeitar a consulta. Usar perfis explícitos; não alterar significado em fallback silencioso.
- A data da Analytics é baseada no horário do Pacífico; persistir `source_timezone=America/Los_Angeles` e converter o slot UTC explicitamente. A fonte reporta latência típica de 48–72 horas; reconsultar janela móvel proposta de pelo menos sete datas Pacific e marcar atraso/parcialidade, nunca preencher lacuna com zero.

### Scheduler 09:00 UTC

`0 9 * * *` deve ser tratado como **slot de coleta**, não como garantia de execução no segundo 00. A documentação Vercel diz que Cron usa UTC, mas Hobby pode ser executado em qualquer momento dentro da janela diária e o delivery é best effort; Cloudflare documenta UTC, mas não SLA de segundo exato. Se o requisito for exatamente 09:00:00 UTC, é bloqueador de scheduler/SLA e não pode ser prometido por opções gratuitas consultadas. Registrar `scheduled_slot=09:00Z` e hora real de início. Usar lease no Postgres, upsert natural e reconciliação para duplicações/atrasos.

### “O que funcionou” e Radar

Primeiro ingerir dados; depois, com cobertura mínima, calcular comparação determinística por coortes comparáveis de formato/idade, mediana/percentis e denominador mínimo. Persistir evidências, período e confiança. Usar linguagem associativa (“associado a”), não causal. O aprendizado do próprio canal deve ser um **sinal interno separado**: o schema atual restringe fontes do Radar a fontes públicas, então não converter automaticamente desempenho interno em tendência pública.

### Tabelas/migrations propostas, não executadas

- `youtube_video_daily_metrics`: channel FK, video/publication interno opcional, `youtube_video_id`, `metric_date`, timezone, views, duração, percentual médio, impressões, CTR, gained/lost, status Analytics/Reach, effective end date, fetched_at, run_id e versão. `NULL` = indisponível/não processado; zero só quando a API devolveu zero.
- Chave única `(channel_id, youtube_video_id, metric_date)` e índices por vídeo/data, canal/data, ranking e reprocessamento. Se cada origem tiver linha separada, incluir provider e unir na camada de leitura.
- Preservar `analytics_snapshots` legado até verificar compatibilidade; não apagar/renomear dados sem decisão do dono.
- `analytics_collection_runs`: trigger, slot UTC, janela pedida, início/fim, última data retornada, status (`running/success/partial/not_ready/failed`), contagens, erro sanitizado, tentativas e lease.
- Reutilizar/extender `quota_log` para provider, operação, batch, status, latência e quantidade de IDs, sem token/PII.
- `analytics_insights`: período, versão do cálculo, tipo, resumo PT-BR, evidências JSONB, confiança e status.
- `radar_learning_signals`: FK de insight, aceitação/estado, data e auditoria, sem misturar com `radar_signals` público.

### Critérios de aceite

Coleta idempotente; conversão Pacific/UTC correta; testes de 0/1/500/501 IDs, duplicata, dados atrasados, 429/5xx/400, lock concorrente, CTR indisponível e estados parcial/não pronto; séries mostram cobertura e atraso; insight reproduzível com evidências; Radar separa aprendizado interno de sinal público; UI não exibe dados de exemplo como reais.

Fontes: [YouTube Analytics metrics](https://developers.google.com/youtube/analytics/metrics), [dimensions](https://developers.google.com/youtube/analytics/dimensions), [channel reports](https://developers.google.com/youtube/analytics/channel_reports), [reports.query](https://developers.google.com/youtube/analytics/reference/reports/query), [data model](https://developers.google.com/youtube/analytics/data_model), [Reporting API channel reports](https://developers.google.com/youtube/reporting/v1/reports/channel_reports), [Reporting API metrics](https://developers.google.com/youtube/reporting/v1/reports/metrics), [Vercel Cron overview](https://vercel.com/docs/cron-jobs), [Vercel Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) e [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## 6. Item 3 — Fluxo C: Longo aprovado para 2–4 Shorts

### Contrato de produto e gates

- Entrada: somente pauta/roteiro Longo com versão exata, Portão 1 aprovado e QA persistido.
- Sugerir 2–4 candidatos, sem forçar quatro; exemplos de cortes candidatos: gancho/problema + evidência; erro/decisão + correção; demonstração + resultado verificável; limitação/lição + CTA.
- Cada filho nasce como rascunho e tem pauta/roteiro/version, QA, assets, render job, manifesto, callback, vídeo e gates próprios.
- Preservar proveniência: parent idea/script/version, digest SHA-256, IDs de cues/seções, trecho literal, intervalo quando disponível, critério de seleção e versão do prompt/modelo.
- Claim sem suporte vira `VALIDAR NO PROJETO`; revisão humana de claims/proveniência é necessária no Gate 1. Aprovação do Longo nunca aprova os filhos nem desbloqueia render/Gate 2.
- Render de cada Short exige Gate 1 do próprio filho e confirmação de custo; Portão 2 exige QA/callback do job correspondente e aprovação humana daquele vídeo. Não publicar automaticamente.
- Se o Longo mudar, filhos ligados à versão anterior ficam `stale_source` até revisão humana; não atualizar em silêncio.
- O prompt atual sugere 30–60 s e 80–150 palavras. Propõe-se hard cap interno de 180 s e 9:16, validados via `ffprobe`; 9:16 é decisão de produto. O YouTube classifica uploads quadrados/verticais de até três minutos como Shorts para canais padrão, mas um Short acima de um minuto com claim ativo de copyright pode ser bloqueado globalmente; revisar direitos por filho.

### Tabelas/migrations propostas, não executadas

- `studio_script_derivations`: batch, parent/child IDs e versões, ordinal 1–4, tipo, refs/excerpt/digest, motivo, provider/prompt version, status, revisão de claims, reviewer/timestamps, perfil e duração.
- `editorial_gate_decisions`: log append-only por escopo script/video + version, gate 1/2, decisão, ator, timestamp, notas, QA hash e confirmação de claims/proveniência. Reutilizar tabela equivalente se o blueprint já tiver uma.
- Estender jobs com derivation, perfil imutável, perfil de saída e decisão Gate 1; estender assets com derivation, versão criança, source asset e QA hash.
- Manter espelho mínimo no JSONB atual apenas por compatibilidade; invariantes/gates ficam relacionais após o blueprint confirmar schema.
- Backfill não deve inventar derivations ou gates para conteúdo antigo; jobs Longo continuam válidos com `derivation_id` nulo.

**Aceite:** um Longo aprovado gera 2–4 candidatos com proveniência; pai e filhos têm gates independentes; claims sem evidência bloqueiam Gate 1; Short fora do perfil bloqueia Gate 2; callbacks duplicados são idempotentes; cada filho possui job/asset/QA próprio; não existe publicação automática.

Fontes: [YouTube Help — Shorts de até três minutos](https://support.google.com/youtube/answer/15424877?hl=en), [YouTube Analytics and Reporting APIs](https://developers.google.com/youtube/analytics) e [GitHub Actions manual workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## 7. Separação proposta de PRs e migrations

Não há migrations criadas ou aplicadas nesta entrega. A PR-00 é documental; nenhuma PR seguinte implementa código até o dono revisar/aprovar o plano e os contratos:

1. **PR-00 — blueprint/contratos:** adicionar o blueprint original, as decisões de schema/parser/lint/worker, o plano atualizado e as referências visuais originais. Sem código ou SQL.
2. **PR-4.0 — parser lint:** gramática, diagnóstico, QA/duração, editor e testes; sem migration salvo necessidade aprovada.
3. **PR-4A — visual policy/adapter/cache:** adapter, política, cache/usage, quota reservation e migration; sem provider real habilitado por padrão.
4. **PR-4B — manifesto/worker/fallback:** assets assinados, seleção captura→imagem→focus frame, motion, synthetic label e QA.
5. **PR-1A — OAuth schema:** ownership/canais/credenciais/state e auditoria; migration isolada.
6. **PR-1B — OAuth server-side:** início/callback, channel discovery, refresh/revoke e testes; sem upload.
7. **PR-1C — UI/status:** corrigir scopes e ligar botão a status sanitizado.
8. **PR-2A — Analytics schema/run:** fatos, runs, leases, quota e compatibilidade legada.
9. **PR-2B — collectors:** consultas Analytics/Reporting, batches e reconciliação.
10. **PR-2C — insights/Radar:** cálculo com evidências e sinal interno separado.
11. **PR-2D — Analytics UI:** série temporal, cobertura, semântica de CTR/retenção e “o que funcionou”.
12. **PR-3A — derivations/schema:** lote, proveniência e gates append-only.
13. **PR-3B — scripts filhos/QA:** 2–4 sugestões, edição individual e revisão de claims.
14. **PR-3C — render independente:** perfil Short, jobs/assets/callbacks próprios, sem publicação.

O nome e número de cada migration dependem da convenção canônica no blueprint. Nenhuma PR deve aplicar migration em produção sem aprovação específica. Manter `pnpm check`, `pnpm test`, testes Python e `pnpm build` verdes antes de abrir cada PR.

## 8. Riscos e dependências gerais

| Tema | Risco ou bloqueador | Mitigação planejada |
|---|---|---|
| Blueprint/schema | O blueprint foi recebido; schema base e operacional continuam em namespaces distintos e a aplicação real das migrations não foi revalidada por SQL nesta PR. | Usar o contrato da PR-00; criar ledger e reconciliação por ambiente antes de nova migration. |
| OAuth | URI de callback, consentimento parcial, refresh inválido e verificação Google. | URI HTTPS exata, state one-shot, cifragem, lock de refresh, reconexão e checklist externo. |
| Analytics | Escopos e combinações de relatório podem divergir; CTR de thumbnail não é CTR de card; datas/latência são Pacific. | Testar contrato autorizado, separar perfis, usar null/partial/not_ready e expor definição da métrica. |
| Scheduler | Free Vercel/Cloudflare não oferece garantia de segundo exato e delivery pode atrasar/falhar. | Slot lógico 09:00 UTC, lease e reconciliação; se requisito rígido, decidir scheduler com SLA/custo. |
| Quotas | Quota Analytics do projeto e limites do modelo visual não são universais nem confirmados para todas as combinações. | Telemetria allowlisted, batches, backoff, hard stops e revalidação antes do piloto. |
| Licença/dados | Licença do modelo não garante direitos do provider, outputs, marcas ou capturas; inputs podem conter PII. | Fixar revisão/termos, revisão jurídica, autorização de captura, moderação e bloqueio com fallback. |
| Render | Worker pode não suportar foco/motion/perfil Short novo; callbacks podem duplicar. | Contrato assinado, `ffprobe`, idempotência, feature flag, teste offline e gate QA. |
| Claims | Derivação pode inventar resultados ou falar notas de produção. | Proveniência literal, lint bloqueante, QA por filho e aprovação humana independente. |
| Radar | Aprendizado do próprio canal não prova demanda pública. | Sinal interno separado, com evidência, período e confiança. |
| Custo de filhos | 2–4 Shorts multiplicam TTS, render, storage e geração visual. | Estimativa por filho, limite 4, confirmação por job e descarte antes do render. |

## 9. Pré-condições para começar implementação

Antes de qualquer código dos itens da Fase 2, revisar e aprovar o [blueprint](../blueprint-canal-youtube.md), este plano e o [contrato PR-00](fase-2-contratos.md). Os pontos abaixo permanecem pré-condições técnicas/produto:

1. Confirmar identidade/autenticação de usuário único, sessão, autorização e isolamento no código; definir URI OAuth HTTPS por ambiente e cofre/rotação da chave de cifragem.
2. Confirmar schema aplicado por ambiente e escolher ledger/runner de migrations; não reaplicar SQL manualmente nem assumir que os arquivos locais espelham produção.
3. Resolver a leitura do resumo operacional atualmente feita em `render_jobs` genérico.
4. Fechar provider/model/revisão visual, custo/quota efetivos, licença/termos e retenção antes de habilitar qualquer geração.
5. Escolher scheduler e aceitar a precisão realmente disponível para o slot 09:00 UTC.
6. Validar o método autorizado e os scopes necessários para cada relatório de Analytics/Reporting, sem ampliar OAuth além da necessidade.
7. Confirmar mapeamento de vídeos publicados para canal/`external_video_id` e política de dados sintéticos.
8. Planejar testes de foco/motion/QA visual e rollout versionado do worker; contrato base está documentado, implementação não existe ainda.
9. Reconciliar `docs/progresso/prova-fase-1-resultado.md` com a conclusão do Job 4 informada pelo dono, preservando a trilha histórica.

Depois disso, o dono aprova o plano atualizado. As autorizações de migrations, credenciais, coleta de produção, geração real, render com custo, merge e deploy continuam separadas. A publicação do YouTube permanece manual.

## Referências oficiais

### Google/YouTube

- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes) — diferencia `youtube.readonly` de `yt-analytics.readonly`.
- [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) — fluxo server-side, redirect URI, state, offline/refresh e consentimento incremental.
- [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies) — proteção de credenciais, revogação e políticas aplicáveis.
- [YouTube OAuth for Server-Side Web Apps](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps) e [channels.list](https://developers.google.com/youtube/v3/docs/channels/list) — fluxo específico e descoberta de canal.
- [Analytics metrics](https://developers.google.com/youtube/analytics/metrics), [dimensions](https://developers.google.com/youtube/analytics/dimensions), [channel reports](https://developers.google.com/youtube/analytics/channel_reports), [reports.query](https://developers.google.com/youtube/analytics/reference/reports/query), [data model](https://developers.google.com/youtube/analytics/data_model) e [sample requests](https://developers.google.com/youtube/analytics/sample-requests).
- [Reporting channel reports](https://developers.google.com/youtube/reporting/v1/reports/channel_reports), [Reporting metrics](https://developers.google.com/youtube/reporting/v1/reports/metrics) e [authorization](https://developers.google.com/youtube/reporting/guides/authorization).
- [YouTube Help — Shorts de até três minutos](https://support.google.com/youtube/answer/15424877?hl=en).

### Scheduler

- [Vercel Cron overview](https://vercel.com/docs/cron-jobs), [management](https://vercel.com/docs/cron-jobs/manage-cron-jobs) e [usage/pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) e [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- [GitHub Actions scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

### Imagens, termos e custo

- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [limits](https://developers.cloudflare.com/workers-ai/platform/limits/), [FLUX.2 klein](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/), [data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) e [terms](https://www.cloudflare.com/terms/).
- [Hugging Face Inference Providers pricing](https://huggingface.co/docs/inference-providers/pricing), [overview](https://huggingface.co/docs/inference-providers/index), [text-to-image](https://huggingface.co/docs/inference-providers/tasks/text-to-image) e [terms](https://huggingface.co/terms-of-service).
- [FLUX.2 klein 4B model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) e [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) e [additional terms](https://ai.google.dev/gemini-api/terms).
- [Replicate billing](https://replicate.com/docs/topics/billing), [rate limits](https://replicate.com/docs/topics/predictions/rate-limits) e [model operation](https://replicate.com/docs/reference/how-does-replicate-work).
