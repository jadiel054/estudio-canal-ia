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
3. No **Estúdio**, registre assets e licenças; clique em **Renderizar e rodar QA**.
4. Em **Fila**, examine o checklist e faça o **Portão 2**.
5. Em **Publicações**, reserve um slot e use **Exportar** para preparar a publicação manual.

## Banco e deploy

O Neon deste sistema contém as tabelas do esquema versionado. Configure sua URL de conexão somente na Vercel como segredo criptografado `STUDIO_DATABASE_URL` para os ambientes necessários. Não use a URL Postgres em `DATABASE_URL`: essa variável é reservada ao adaptador de usuários Drizzle/MySQL do template. Nenhuma credencial real deve entrar no Git.

A interface editorial ainda salva seu estado no navegador. O backend Neon atual fornece persistência de auditoria/status, não sincronização completa de pautas, roteiros, vídeos e configurações entre dispositivos. O projeto pode ser compilado localmente com:

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
- **Produção de mídia:** render remoto FFmpeg/Actions e TTS ainda precisam de configuração; registre a licença de cada asset e mantenha revisão humana antes de publicar.

## Segurança

O Nexo não exibe chaves. Não publique segredos, tokens ou arquivos `.env`. Use somente as variáveis vazias documentadas em `.env.example` como nomes de referência; cadastre valores reais no cofre de segredos do ambiente.
