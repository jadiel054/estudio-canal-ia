# Estúdio de Canal IA

PWA mobile-first em PT-BR para planejar e operar conteúdo técnico de YouTube, com TikTok preparado como segunda plataforma. O painel organiza o fluxo `tendência/projeto → pauta → roteiro → Portão 1 → produção/QA → Portão 2 → agenda/exportação`. A publicação automática permanece bloqueada por padrão.

## O que funciona neste corte

- Painel com Início, Radar, Pautas, Roteiros, Estúdio, Fila, Publicações, Lives, Analytics, Nexo, Integrações, Configurações e Logs/Custos.
- Dois portões de aprovação e fluxo editorial auditável no navegador.
- Modo de demonstração gratuito, dados locais em `localStorage`, manifesto instalável PWA e exportação manual.
- Backend Express/tRPC pronto para execução no servidor; entrypoint Express em `index.ts` para a Vercel. O build Vite gera `public/` (artefato ignorado pelo Git) para distribuição estática.
- Projeto Neon dedicado `estudio-canal-ia` em São Paulo; o esquema versionado está em `database/neon-schema.sql` e as tabelas já foram conferidas.

## Primeiro vídeo no modo atual

1. Abra **Radar** e escolha uma tendência, ou crie uma pauta em **Pautas** a partir de um projeto seu.
2. Gere e edite o roteiro; confira a demonstração real e aprove no **Portão 1**.
3. No **Estúdio**, confira o estado das integrações sem expor segredos, registre capturas seguras e use o fluxo de render real somente após a aprovação do Portão 1 e a confirmação do dono.
4. Em **Fila**, examine o MP4 e o QA verificável e faça manualmente o **Portão 2**.
5. Baixe e publique manualmente. Depois de confirmar a publicação, solicite a limpeza da cópia temporária e confira a execução do workflow.

## Banco e deploy

O Neon deste sistema contém as tabelas do esquema versionado. Configure sua URL de conexão somente na Vercel como segredo criptografado `STUDIO_DATABASE_URL` para os ambientes necessários. Não use a URL Postgres em `DATABASE_URL`: essa variável é reservada ao adaptador de usuários Drizzle/MySQL do template. Nenhuma credencial real deve entrar no Git.

O estado editorial de produção é persistido e versionado no Neon; `localStorage` permanece como fallback/demonstração. Capturas e jobs reais ficam em tabelas separadas. O projeto pode ser compilado localmente com:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

Vercel está configurada para construir pelo repositório conectado e usar o app Express em `index.ts`, com o frontend compilado em `public/`.

## O que ainda depende do operador ou de implementação

- **Autenticação no Vercel:** as rotas protegidas ainda usam a autenticação Manus. É necessário adaptar/configurar um provedor de login compatível antes de habilitar Nexo e as funções protegidas fora do Manus. Não torne essas rotas públicas como atalho.
- **LLM no Vercel:** o acesso ao runtime LLM Manus não é transferido automaticamente para Vercel. Configure um provedor externo e adapte sua chamada no servidor antes de esperar respostas generativas do Nexo.
- **YouTube e TikTok:** a interface mostra as conexões, mas fluxos OAuth, upload, leitura de quota e analytics reais precisam ser implementados. Depois, o operador deverá criar/aprovar os aplicativos de desenvolvedor, informar Client ID/Secret e URIs de redirecionamento e conceder os escopos mínimos. A publicação manual permanece disponível.
- **Produção de mídia:** o pipeline real FFmpeg/Actions, Gemini TTS, portões e limpeza manual pós-publicação estão integrados na `main` e implantados. O dono informou que cadastrou `GITHUB_ACTIONS_TOKEN` e `STUDIO_RENDER_HMAC_SECRET`; confirme no painel de integrações apenas o estado, nunca os valores. A prova ponta a ponta e a aceitação da voz PT-BR pelo dono ainda estão pendentes.

## Segurança

O Nexo não exibe chaves. Não publique segredos, tokens ou arquivos `.env`. Use somente as variáveis vazias documentadas em `.env.example` como nomes de referência; cadastre valores reais no cofre de segredos do ambiente.

## Etapa B — Radar real e QA do roteiro

A coleta diária das fontes gratuitas, o score explicável, o cadastro de pautas com notas/referências e o QA server-side do Portão 1 estão descritos em [`docs/progresso/etapa-b-radar.md`](docs/progresso/etapa-b-radar.md). A primeira execução forma a linha de base de crescimento; a análise LLM depende dos provedores já configurados no cofre do ambiente.

## Etapa C — pipeline de render real

O render, HMAC, worker FFmpeg, capturas privadas, QA do MP4, download autenticado e workflow de limpeza estão detalhados em [`docs/progresso/etapa-c-progresso.md`](docs/progresso/etapa-c-progresso.md). A Etapa C está mesclada e implantada; falta a prova ponta a ponta assistida. O primeiro render real consome quota e cria um Release temporário, então deve aguardar autorização explícita do dono. Portões 1 e 2 e publicação continuam manuais.
