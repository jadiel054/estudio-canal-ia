# Etapa C — relatório de implementação

**Data:** 13/10/2026
**Estado:** código implementado e validado localmente na branch `feat/etapa-c-fundacao`; ainda não implantado em produção nem testado com um roteiro/voz reais. O repositório foi tornado privado após autorização explícita do dono.

## O que foi implementado

- **Voz:** adaptador Gemini TTS no servidor, com modelo principal/fallback configuráveis, amostra de voz, validação de WAV e timeout. A interface permite escolher a voz e o modo **TTS** ou **música procedural + texto**. Não selecionei Piper: a licença comercial dos pesos PT-BR não está suficientemente esclarecida nas fontes consultadas.
- **Entrada de mídia:** upload autenticado de até cinco capturas PNG/JPEG/WebP por roteiro aprovado, até 2 MB por arquivo, validando tipo real, hash e versão do roteiro. As capturas permanecem privadas no Neon.
- **Render real:** job persistido e transacional no Neon; GitHub Actions recebe somente o UUID do job; manifesto mínimo e imutável é buscado via endpoint HMAC; o worker usa FFmpeg e Pillow para compor Shorts 1080×1920 ou vídeos horizontais 1280×720, legendas e áudio. Não há “sucesso” fabricado.
- **Segurança:** assinatura HMAC com timestamp, método, caminho e corpo bruto; validação do manifesto/arquivos e callbacks idempotentes; leitura do MP4 por proxy autenticado, sem URL pública permanente. O GitHub Release fica como rascunho em repositório privado.
- **Portões editoriais:** o worker só aceita roteiro real, QA persistido, versão atual e aprovação do Portão 1. O Portão 2 exige MP4 real e QA verificável; aprovação, pedido de ajuste e rejeição continuam ações humanas.
- **Exportação e retenção:** o dono pode baixar a prévia pelo Estúdio. Depois de aprovar o Portão 2 e publicar manualmente, a ação **“Já publiquei — limpar cópia”** desativa imediatamente o download e despacha um workflow de remoção do draft Release, assets e tag. A remoção roda de forma assíncrona no GitHub Actions; confirme o resultado na execução do workflow. A publicação em YouTube continua manual.
- **Banco:** a migração aditiva foi aplicada no projeto Neon dedicado `misty-dust-45555125` e verificada. Tabelas criadas: `studio_render_jobs`, `studio_render_inputs`, `studio_render_assets`, `studio_render_manifest_hashes` e `studio_render_callback_events`.

## Validação executada

| Verificação | Resultado |
|---|---|
| `pnpm check` | passou |
| `pnpm test` | 15 arquivos, 74 testes passaram |
| `python3 -m unittest scripts.test_render_video` | 7 testes passaram |
| `pnpm build` | passou (Vite + bundle do servidor) |
| `git diff --check` | passou |
| Smoke render FFmpeg local | MP4 H.264/AAC real, 1080×1920, 5,429 s, QA mecânico aprovado |

O smoke render usa uma **fixture local** com trilha procedural; não acessou o Neon, Gemini, GitHub nem dados do usuário. Durante o teste, encontrei e corrigi uma combinação FFmpeg incompatível (`-fps_mode vfr` junto de `-r 30`); o worker agora gera CFR a 30 fps.

## O que ainda impede a prova ponta a ponta em produção

1. **PAT de dispatch:** o endpoint precisa de `GITHUB_ACTIONS_TOKEN` na Vercel. O token deve ser fine-grained, limitado ao repositório `jadiel054/estudio-canal-ia`, com `Actions: read/write` e `Contents: read`. A integração GitHub disponível retornou HTTP 403 ao consultar Actions Secrets; não tentei contornar nem solicitei tokens por chat.
2. **HMAC compartilhado:** criar um segredo aleatório de pelo menos 32 caracteres e cadastrar o mesmo valor como `STUDIO_RENDER_HMAC_SECRET` no ambiente **Production** da Vercel e como secret do repositório em **Settings → Secrets and variables → Actions**. Não envie esse valor em mensagens.
3. **Roteiro e voz reais:** a prova requer uma pauta real, gerar/revisar o roteiro e aprová-lo no Portão 1. Se usar TTS, ouvir a amostra PT-BR e confirmar a qualidade antes de iniciar o render. O painel não trata demonstração nem dados de seed como produção.
4. **Deploy:** o código está na branch de trabalho; precisa ser revisado/mesclado em `main` para que Vercel publique as rotas e GitHub encontre os workflows. Até lá, o deployment existente não contém esta Etapa C.

### Configuração pelo navegador no celular

1. No GitHub, crie um **fine-grained personal access token** em *Settings → Developer settings → Personal access tokens → Fine-grained tokens*. Selecione `jadiel054`, limite o acesso a `estudio-canal-ia` e conceda somente `Actions: Read and write` e `Contents: Read-only`; escolha uma expiração curta compatível com a operação.
2. Na Vercel, abra o projeto **estudio-canal-ia → Settings → Environment Variables** e adicione `GITHUB_ACTIONS_TOKEN` somente para **Production**. Cole o token diretamente no cofre da Vercel; não o envie pelo chat.
3. Gere um segredo aleatório no gerenciador de senhas do aparelho. Cadastre o mesmo valor em `STUDIO_RENDER_HMAC_SECRET` (Vercel Production) e em GitHub **Settings → Secrets and variables → Actions → New repository secret**, também com o nome `STUDIO_RENDER_HMAC_SECRET`.
4. Depois do deploy, confira **Estúdio → Integrações de produção**. Quando Neon, token e HMAC aparecerem configurados, use uma pauta real, aprove o roteiro no Portão 1, ouça a amostra TTS e só então inicie o render.

## Privacidade e uso da voz

A documentação do Gemini informa que, no nível gratuito, entradas e saídas podem ser usadas para melhoria de produtos e revisadas por pessoas. Não envie segredos, dados pessoais ou material confidencial ao TTS gratuito. A documentação permite uso profissional segundo os termos aplicáveis, mas não garante exclusividade nem substitui revisão jurídica. A aceitação do sotaque brasileiro deve ser confirmada por amostra pelo dono.

## Referências oficiais consultadas

- [Termos adicionais da Gemini API](https://ai.google.dev/gemini-api/terms) e [preços/nível gratuito](https://ai.google.dev/gemini-api/docs/pricing).
- [Documentação Gemini Speech Generation](https://ai.google.dev/gemini-api/docs/speech-generation).
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) e [download de Release asset](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).
- [Dispatch de workflow por API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) e [permissões de PAT fine-grained](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
- [Billing/limites do GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- [Discussão oficial sobre a licença dos pesos Piper](https://huggingface.co/rhasspy/piper-voices/discussions/111).
