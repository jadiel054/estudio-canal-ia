# Plano de implementação — Estúdio de Canal IA

## Produto e escopo

O Estúdio de Canal IA será um PWA pessoal, mobile-first e em PT-BR para operar um canal sem rosto de tutoriais de programação e agentes de IA. O núcleo é um fluxo rastreável de `tendência/projeto → pauta → roteiro → aprovação 1 → produção → QA → aprovação 2 → agendamento/publicação → analytics`, sem publicação autônoma por padrão. A primeira entrega é um MVP utilizável com dados persistidos localmente no navegador quando a base externa ainda não estiver configurada; a camada de repositório já ficará preparada para Neon Postgres, sem reescrever o domínio.

As integrações YouTube e TikTok entrarão como adaptadores: a interface e as regras de permissão estarão implementadas desde o MVP, enquanto OAuth, chaves e upload efetivo só serão ativados depois de o operador fornecer as credenciais no cofre. O YouTube permanecerá bloqueado em modo de exportação manual até a conexão e aprovação do operador. TikTok ficará pronto para conectar, mas desativado enquanto não houver credenciais.

## Arquitetura

- **Aplicação:** React + TypeScript + Wouter no cliente; Express + tRPC no servidor.
- **Dados:** contratos de domínio e repositório para canais, tendências, pautas, roteiros, assets, vídeos, revisões, publicações, analytics, adaptadores, configurações e auditoria. O modo de demonstração usa armazenamento local versionado; o adaptador Neon será ativado via `DATABASE_URL` protegida e migração SQL versionada.
- **Agente:** `Nexo`, produtor executivo de IA — profissional, objetivo e cuidadoso com qualidade editorial. Um system prompt versionado define o nicho, as duas aprovações humanas, regras anti-conteúdo em massa, requisitos de demonstração real e limites de segurança. O chat oferece ferramentas controladas: consultar fila/status, criar pauta, alterar modo de uma etapa e trocar adaptador. Operações sensíveis retornam pedido de confirmação em vez de executar.
- **Integrações:** registros de adaptador por função (LLM, TTS, transcrição, pesquisa, render e publicação), prioridade/fallback, status, limite e custo. Nenhuma chave é mostrada, armazenada no cliente ou exposta em logs.
- **Jobs:** render, radar e QA são modelados como jobs idempotentes com estado, tentativas e erro visível. O MVP simula a execução de forma auditável para validar o fluxo; um endpoint de cron será preparado para coleta diária após o deploy.
- **Mídia:** assets carregados/registrados incluem tipo, licença, custo e origem. O fluxo de render produz uma prévia e permite exportar o briefing de produção enquanto FFmpeg/Actions ainda não estiver conectado.

## Fluxos e estados

A máquina de estados é: `ideia → pesquisa → roteiro → aguarda_aprov_roteiro → assets → render → qa → aguarda_aprov_video → agendado → publicado`; as saídas laterais são `ajuste_pedido`, `rejeitado` e `erro`. Cada transição cria item no log de auditoria. Os dois portões exigem ação explícita do operador. Publicação automática, aumento do teto mensal e exclusão/exportação destrutiva exigem confirmação clara.

O sistema inicia com um conjunto pequeno de dados de exemplo, permitindo demonstrar Radar, pauta, roteiro, QA, aprovações, agenda, analytics e o agente sem depender de uma chave externa. Todos os estados incluem carregando, vazio, sucesso ou erro/tentar novamente onde a ação for assíncrona.

## Navegação e páginas

- **Início:** visão semanal, ações críticas, metas, custo e quota.
- **Radar:** tendências com fontes, pontuação explicável, detalhe e criação de pauta.
- **Estúdio:** pauta, roteiro, editor, assets, render, prévia e exportação manual.
- **Fila:** filtros por etapa, ações de aprovar, pedir ajuste e rejeitar.
- **Publicações/Agenda:** slots agendados, modo manual, marcação sintética e canais.
- **Mais:** Lives, Analytics, Chat Nexo, Integrações, Configurações, Logs e Custos.
- **TikTok:** aparece nas conexões e na distribuição de cada vídeo, em estado “pronto para conectar”; nenhum envio ocorre sem OAuth e confirmação.

## Design

- **Movimento:** *mission-control editorial*, inspirado em painéis de produção de vídeo e ferramentas de desenvolvimento, não em dashboards financeiros genéricos.
- **Princípios:** foco em uma decisão por vez; contexto e justificativa sempre visíveis; hierarquia de risco; conforto em telas pequenas no período noturno.
- **Cores:** superfície quase preta azulada para reduzir fadiga; o verde-lima elétrico `#C6FF4D` é a cor de assinatura para avanço/aprovação; violeta identifica IA; âmbar alerta quota; coral bloqueia risco. Cor nunca é o único indicador.
- **Layout:** trilho editorial vertical no mobile, com cabeçalho compacto, cartões sobrepostos e barra inferior fixa; no desktop, o trilho expande para barra lateral sem perder o fluxo sequencial.
- **Elementos de assinatura:** pulso “Nexo ativo”, linha de produção com etapas conectadas e cartões de “por quê” para cada decisão do agente.
- **Interação:** ações principais têm alvo amplo; toda ação apresenta resultado, histórico ou motivo para indisponibilidade. Setas voltar preservam a tela/estado anterior. Destrutivos usam diálogo de confirmação.
- **Animação:** transições curtas de 160–220 ms; o estado da fila desliza uma etapa quando alterado; sem animações contínuas que dificultem leitura.
- **Tipografia:** `Space Grotesk` para títulos e estado operacional; `DM Sans` para conteúdo, números e microcopy.
- **Marca:** **Estúdio de Canal IA — a central de produção editorial que transforma sinais técnicos em vídeos revisados, não em conteúdo em massa.** Personalidade: precisa, serena, criativa.
- **Voz:** direta e orientada a decisão. Exemplos: “3 sinais merecem pauta hoje.” e “O render está pronto; falta sua revisão final.”
- **Logotipo:** um quadro de vídeo dividido por uma trilha de automação, formando discretamente o monograma “E”.

## Estrutura de arquivos

```text
client/src/
  components/        Layout, navegação, cartões, modais e componentes do estúdio
  data/              Dados de demonstração e tipos compartilhados para o modo local
  pages/             Rotas funcionais do painel
  store/             Estado local, persistência e ações auditáveis
  App.tsx            Rotas, provedores e shell do aplicativo
server/
  agent/             System prompt, allowlist de ferramentas e execução controlada
  domain/            Tipos de workflow, políticas e adaptadores
  routers.ts         tRPC: chat, operações protegidas e health
  db.ts              Adaptador de persistência externa quando DATABASE_URL existir
database/            Esquema Neon Postgres e instruções de migração
public/              Manifest PWA, ícones e manus-routes.json
README.md            Configuração do primeiro vídeo e integrações
```

## Restrições materiais e pendências externas

O app não irá inventar credenciais, fazer upload, publicar, revogar token, excluir dados ou aumentar custos sem autorização. Para ativar produção real, o operador precisará informar com segurança: `DATABASE_URL` do Neon; OAuth/Client ID/Client Secret do YouTube; tokens/credenciais do TikTok quando desejar conectá-lo; e, opcionalmente, provedores de TTS/render. GitHub Actions e deploy externo são preparados no repositório, mas a publicação por APIs de plataformas dependerá da auditoria/escopos dessas plataformas.
