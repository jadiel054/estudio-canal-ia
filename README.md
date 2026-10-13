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
3. No **Estúdio**, registre capturas e licenças; após configurar a Etapa C, inicie o render real de um roteiro aprovado.
4. Em **Fila**, examine o MP4 e o QA verificável e faça manualmente o **Portão 2**.
5. Baixe e publique manualmente. Depois de confirmar que publicou, use **Já publiquei — limpar cópia** para remover o Release temporário privado.

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
- **Produção de mídia:** o pipeline real FFmpeg/Actions, Gemini TTS, portões e limpeza manual pós-publicação estão implementados na branch da Etapa C; precisam de `GITHUB_ACTIONS_TOKEN` e `STUDIO_RENDER_HMAC_SECRET` configurados de forma protegida antes do uso. A execução real e a qualidade PT-BR ainda exigem teste/validação do dono.

## Segurança

O Nexo não exibe chaves. Não publique segredos, tokens ou arquivos `.env`. Use somente as variáveis vazias documentadas em `.env.example` como nomes de referência; cadastre valores reais no cofre de segredos do ambiente.

## Etapa B — Radar real e QA do roteiro

A coleta diária das fontes gratuitas, o score explicável, o cadastro de pautas com notas/referências e o QA server-side do Portão 1 estão descritos em [`docs/progresso/etapa-b-radar.md`](docs/progresso/etapa-b-radar.md). A primeira execução forma a linha de base de crescimento; a análise LLM depende dos provedores já configurados no cofre do ambiente.

## Etapa C — pipeline de render real

O render, HMAC, worker FFmpeg, capturas privadas, QA do MP4, download autenticado e workflow de limpeza estão detalhados em [`docs/progresso/etapa-c-progresso.md`](docs/progresso/etapa-c-progresso.md). **O código dessa etapa precisa ser mesclado/deployado e receber as credenciais descritas no relatório antes de processar um vídeo real.**
