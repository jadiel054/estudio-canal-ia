# Estúdio de Canal IA

PWA pessoal, mobile-first e em PT-BR para criar conteúdo técnico original para YouTube, com TikTok preparado como segunda plataforma. O estúdio opera o fluxo `tendência/projeto → pauta → roteiro → Portão 1 → assets/render/QA → Portão 2 → agenda/exportação`, sempre com revisão humana por padrão.

## O que já funciona nesta primeira entrega

- Painel completo: Início, Radar, Pautas, Roteiros, Estúdio, Fila, Publicações, Lives, Analytics, Nexo, Integrações, Configurações e Logs/Custos.
- Dois portões de aprovação e uma máquina de estados visível; toda alteração local entra na auditoria.
- Nexo com identidade, regras editoriais, limites de segurança e comandos controlados para criar pauta, mudar automação, consultar fallback e preparar conexões.
- Adaptadores trocáveis para LLM, TTS, transcrição, render e pesquisa; YouTube e TikTok visíveis desde o início.
- Modo de validação gratuito e persistência local no navegador, permitindo usar todos os fluxos antes de configurar contas externas.
- Projeto Neon Postgres dedicado criado em São Paulo, com o esquema completo já aplicado.

## Primeiro vídeo — roteiro rápido

1. Abra **Radar** e escolha uma tendência, ou crie uma pauta em **Pautas** a partir de um projeto seu.
2. Gere e edite o roteiro; confira a demonstração real, a originalidade e aprove no **Portão 1**.
3. No **Estúdio**, registre capturas, código, voz e as licenças; então clique em **Renderizar e rodar QA**.
4. Em **Fila**, examine o checklist e faça o **Portão 2**. Um aviso de licença pendente pode ser aprovado conscientemente ou devolvido para ajuste.
5. Em **Publicações**, reserve um slot e use **Exportar** para obter o pacote de publicação manual.

## Conexões necessárias para produção real

O sistema não inclui nem expõe segredos. Use o cofre do ambiente para cada item:

| Item | Para que serve | Situação |
| --- | --- | --- |
| `DATABASE_URL` do novo Neon | Persistir dados do estúdio fora do navegador | Projeto e tabelas prontos; falta inserir no cofre |
| OAuth do YouTube | Upload, leitura de quota e analytics reais | Adaptador pronto; requer Client ID/Secret, escopos e auditoria do Google |
| OAuth do TikTok | Distribuição opcional no TikTok | Adaptador pronto; requer app e credenciais TikTok |
| TTS/render externos (opcional) | Substituir os adaptadores gratuitos | Configurável por adaptador; comece com Piper e FFmpeg/GitHub Actions |

> Para validar o canal, mantenha a publicação manual até ter os primeiros vídeos e confirmar a auditoria de conformidade da API do YouTube. Projetos novos podem ficar limitados a uploads privados.

## Desenvolvimento

```bash
pnpm dev
pnpm check
pnpm build
```

O esquema Neon versionado está em [`database/neon-schema.sql`](database/neon-schema.sql). A conexão de produção deve ser configurada exclusivamente por segredo de ambiente; nunca crie `.env` com chave real nem publique credenciais no Git.

## Guardrails de conteúdo e segurança

- Conteúdo deve incluir tela/código/projeto real, roteiro original e formatos variados.
- Nexo não lê segredos, não publica sozinho e pede confirmação para exclusão, aumento de custo e autonomia sensível.
- Assets precisam registrar origem/licença; conteúdo sintético deve ser marcado quando aplicável.
- Token OAuth deve usar escopo mínimo e poder ser revogado. Logs não podem conter dados sensíveis.
