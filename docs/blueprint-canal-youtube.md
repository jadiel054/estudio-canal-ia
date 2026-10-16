# Blueprint — Estúdio de Canal YouTube Semi-Autônomo

**Nicho:** tutoriais de programação e agentes de IA por stack (PT-BR), sem rosto **Uso:** pessoal, mobile-first (PWA) · **Fase inicial:** 100% ferramentas gratuitas, depois upgrade pago

> Premissas assumidas (ajustáveis em Configurações): 2 vídeos longos + 4 Shorts + 1 live por semana. Verifique limites e licenças das ferramentas antes de cada fase; planos gratuitos mudam.

---

## 1. Visão geral

**Objetivo:** um painel único onde agentes pesquisam tendências, criam roteiros, produzem vídeos e agendam publicações, com você aprovando em pontos de controle.

**Princípios**

- Semi-autônomo: 2 portões humanos (roteiro e vídeo final). Nenhuma publicação sem aprovação.
- Anti "conteúdo em massa": todo vídeo tem demonstração real (tela/código executado), roteiro original e variação de formato.
- Custo zero na validação; cada integração é trocável por adaptador (gratuito → pago sem reescrever).

**Métrica de validação (30 dias):** 10 vídeos publicados, CTR, retenção média, inscritos. Só migrar para pago se houver sinal (ex.: retenção > 40% em longos e crescimento semanal de inscritos).

---

## 2. Personas

| Persona | Papel |
| --- | --- |
| **Operador (você)** | Único usuário humano. Define temas, aprova, grava voz de referência, publica. |
| **Agente Pesquisador** | Coleta e pontua tendências. |
| **Agente Roteirista** | Gera pauta e roteiro (longo, Short, live). |
| **Agente Produtor** | Voz, visuais, render. |
| **Agente Revisor (QA)** | Checklist automático antes do seu portão final. |
| **Agente Publicador** | Upload, metadados, agendamento. |

---

## 3. Navegação (barra inferior)

`Início · Radar · Estúdio · Fila · Mais`

| Aba | Telas (todas com seta "voltar" funcional) |
| --- | --- |
| **Início** | Resumo da semana, itens que precisam de ação, custos, quota da API |
| **Radar** | Lista de tendências → Detalhe da tendência → "Criar pauta" |
| **Estúdio** | Pautas → Roteiro (editor) → Assets → Render → Prévia |
| **Fila** | Aguardando roteiro · Aguardando vídeo · Agendados · Publicados · Rejeitados/Erro |
| **Mais** | Lives, Analytics, Integrações, Configurações, Logs, Conta |

**Regra de UI (obrigatória):** nenhum botão sem ação. Todo elemento ou executa algo, ou aparece desabilitado com motivo visível. Toda chamada tem 4 estados: carregando, vazio, sucesso, erro (com "tentar de novo" funcional). Seta "voltar" sempre retorna à tela anterior com o estado preservado.

---

## 4. Módulos

1. **Radar de Tendências** Fontes gratuitas: Hacker News API, GitHub Trending, dev.to API, YouTube Data API (busca, com quota), Google Trends (não oficial, instável). Pontuação = volume × crescimento × lacuna em PT-BR × aderência ao nicho. Agenda diária.
2. **Pautas** Origem: Radar *ou* seus projetos reais (você cadastra: "mostrar como fiz X"). Campos: tema, formato (longo/Short/live), ângulo, público, palavras-chave.
3. **Roteirista** Gera roteiro por template (gancho, problema, demonstração, resultado, CTA). Longo → derivados automáticos em Shorts. Editor com versões.
4. **Estúdio**
   - **Voz:** modo A = TTS gratuito/open-source; modo B = voz clonada sua (ver riscos). Modo C = música + texto na tela.
   - **Visual:** capturas de tela/código, slides, diagramas; legendas automáticas.
   - **Render:** FFmpeg/Remotion em job assíncrono.
5. **Fila de revisão** Portão 1 (roteiro) e Portão 2 (vídeo + QA). Ações: aprovar, pedir ajuste (com comentário), rejeitar.
6. **Publicação** Upload via YouTube Data API, título/descrição/tags/thumbnail, agendamento, marcação de conteúdo sintético quando aplicável.
7. **Lives** Fase 1: Estreia (Premiere) agendada com vídeo pré-renderizado. Fase 3: live real via RTMP (OBS/FFmpeg) e, depois, 24/7 em VPS.
8. **Analytics** Snapshots diários (views, retenção, CTR, inscritos) e relatório "o que funcionou" que realimenta o Radar.
9. **Integrações e Configurações** Contas conectadas, chaves, adaptadores ativos (gratuito/pago), limites de custo.
10. **Logs e Custos** Auditoria de cada ação de agente, custo por vídeo, consumo de quota.

---

## 5. Configurações de conta

- Conexão OAuth do YouTube (conectar, reconectar, revogar).
- Chaves de API em cofre (nunca exibidas após salvas; criptografadas).
- Frequência-alvo semanal por formato.
- Modo de autonomia: *Total revisão* (padrão) · *Amostra* (futuro).
- Teto mensal de gasto e alerta de quota.
- Perfil de voz (referência de áudio, consentimento registrado).
- Exportar e apagar todos os dados.

---

## 6. LGPD e compliance

- **Dados pessoais tratados:** só os seus (conta Google, amostra de voz). Sem terceiros.
- **Voz clonada:** guardar consentimento próprio, armazenar a amostra criptografada, permitir exclusão. Usar só a sua voz.
- **Tokens OAuth:** criptografados, escopo mínimo (`youtube.upload`, `youtube.readonly`), revogáveis.
- **Direitos autorais:** só música com licença compatível (biblioteca de áudio do YouTube ou licenças livres, registrando a fonte por vídeo); código exibido com licença verificada; sem trechos de terceiros.
- **Políticas do YouTube:** manter registro de revisão humana por vídeo, variar formatos, evitar produção repetitiva; marcar conteúdo sintético realista conforme as regras vigentes.
- **Monetização (YPP):** conferir os requisitos atuais de inscritos e horas/visualizações antes de planejar receita.

---

## 7. Modelo de dados

| Tabela | Campos principais |
| --- | --- |
| `channels` | id, nome, youtube_channel_id, token_ref, status |
| `trend_sources` | id, tipo, config, ativo |
| `trends` | id, fonte_id, titulo, url, score, coletado_em, status |
| `ideas` | id, trend_id?, origem(radar/projeto), tema, formato, angulo, status |
| `scripts` | id, idea_id, versao, conteudo, status, aprovado_em |
| `assets` | id, script_id, tipo(voz/video/img/musica/legenda), uri, licenca, custo |
| `videos` | id, script_id, formato, estado, uri_final, duracao, qa_resultado |
| `render_jobs` | id, video_id, status, tentativas, erro, iniciado_em, fim_em |
| `reviews` | id, alvo_tipo, alvo_id, portao(1/2), decisao, comentario, em |
| `publications` | id, video_id, youtube_video_id, agendado_para, publicado_em, sintetico(bool) |
| `lives` | id, tipo(premiere/rtmp/24x7), agendado_para, status |
| `analytics_snapshots` | id, publication_id, data, views, retencao, ctr, inscritos |
| `adapters` | id, tipo(llm/tts/render/…), provedor, plano(free/paid), ativo |
| `quota_log` | id, api, unidades, em |
| `audit_log` | id, ator(agente/usuario), acao, alvo, em, detalhes |
| `settings` | chave, valor |

**Máquina de estados do vídeo:** `ideia → pesquisa → roteiro → aguarda_aprov_roteiro → assets → render → qa → aguarda_aprov_video → agendado → publicado` Saídas laterais: `ajuste_pedido` (volta ao estágio anterior), `rejeitado`, `erro` (com retry manual e automático limitado).

---

## 8. Fluxos principais

**Fluxo A — Tendência → vídeo**

1. Pesquisador pontua tendências → você abre o Radar e toca em "Criar pauta".
2. Roteirista gera roteiro → **Portão 1**.
3. Produtor gera voz/visual/render → Revisor roda QA (duração, áudio, legenda, licenças, originalidade) → **Portão 2**.
4. Publicador agenda → publica → Analytics coleta.

**Fluxo B — Projeto seu → vídeo** Você cadastra um projeto ("mostrei como construí o Zarith") + capturas de tela → Roteirista monta o tutorial → segue do Portão 1 em diante.

**Fluxo C — Longo → Shorts** Aprovado o longo, o sistema sugere 2–4 cortes; cada Short passa por Portão 2.

**Fluxo D — Live** Fase 1: agendar Estreia com vídeo aprovado. Fase 3: configurar RTMP, teste de sinal, iniciar/encerrar com confirmação.

**Tratamento de erros:** cada etapa falha de forma visível (tela com motivo, botão "tentar de novo", botão "voltar ao rascunho"); nada fica em estado "carregando" sem timeout.

---

## 9. Requisitos não-funcionais

- **Mobile-first PWA**, uso confortável em Android, offline apenas para leitura de rascunhos.
- **Idempotência** em jobs (reprocessar não duplica upload nem custo).
- **Quota:** o upload consome muitas unidades da quota diária; contador visível e bloqueio preventivo.
- **Segurança:** segredos no servidor, autorização verificada no servidor (usuário único), HTTPS, logs sem dados sensíveis.
- **Observabilidade:** log por job, custo por vídeo, alertas de falha.
- **Desempenho:** render fora do app (worker assíncrono); UI nunca bloqueia.

---

## 10. Infraestrutura e deploy

**Fase gratuita (validação)**

| Camada | Opção |
| --- | --- |
| Painel PWA | Vercel (free) |
| Banco | Neon Postgres (free; escala a zero sem pausar o projeto) |
| Auth | Login de usuário único no próprio app (ex.: Auth.js) |
| Arquivos temporários | Storage de objetos gratuito (ex.: Cloudflare R2 ou bucket do Neon), com limpeza após a publicação |
| Orquestração | Funções serverless + agenda (cron) |
| **Render de vídeo** | GitHub Actions (job disparado pelo painel). Hospedagem gratuita comum não aguenta FFmpeg pesado |
| LLM | Camadas gratuitas (ex.: Gemini, Groq), via adaptador |
| TTS | Piper ou similar open-source em PT-BR |
| Música | Biblioteca de áudio do YouTube / licenças livres |
| Pesquisa | HN API, GitHub, dev.to, YouTube Data API |

**Atenção:** projetos de API novos podem ter uploads bloqueados como privados até passarem por auditoria de conformidade do YouTube. Peça a auditoria cedo (ou publique manualmente os primeiros vídeos pelo app do YouTube, usando o sistema só para produzir).

**Fase paga (após validar):** TTS/clonagem de voz de melhor qualidade, LLM premium, VPS para render e live 24/7, geração de vídeo/imagem por IA.

**Deploy:** repositório único, ambientes `dev` e `prod`, migrações versionadas, variáveis de ambiente por ambiente.

---

## 11. Roadmap

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| **0 — Validação manual (sem sistema)** | 3 vídeos reais com ferramentas gratuitas, publicados à mão | Fluxo de produção definido e custo real medido |
| **1 — MVP** | Radar + Pautas + Roteirista + Fila + Estúdio básico (longo) | 1 vídeo completo gerado ponta a ponta com 2 portões |
| **2 — Shorts e Analytics** | Cortes automáticos, publicação agendada, snapshots | 10 vídeos em 30 dias; relatório "o que funcionou" |
| **3 — Lives e upgrades** | Estreias, RTMP, adaptadores pagos | Decisão baseada em métricas de retenção e inscritos |
| **4 — Escala** | Live 24/7, modo Amostra, mais canais | Receita cobrindo custos |

---

## 12. Decisões de design

- Tema escuro por padrão (uso noturno e economia de bateria), alvos de toque grandes, uma ação principal por tela.
- Cartões de status coloridos (cor + ícone + texto, nunca só cor).
- Toda decisão do agente mostra o "porquê" (fonte, pontuação, checklist do QA).
- Ações destrutivas (rejeitar, apagar, revogar) pedem confirmação.
- Adaptadores trocáveis: nenhum provedor é acoplado ao núcleo.
- Linguagem da interface: PT-BR.

---

## Riscos principais

1. **Desmonetização por conteúdo percebido como automatizado:** mitigação = demonstrações reais, revisão humana, variação de templates.
2. **Quota e auditoria da API do YouTube:** mitigação = contador de quota, pedir auditoria cedo.
3. **Limites de planos gratuitos:** mitigação = adaptadores e fila com retentativa.
4. **Qualidade da voz clonada gratuita e licenças de modelos:** conferir a licença para uso comercial antes de monetizar.