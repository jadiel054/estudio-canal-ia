# Etapa C — relatório de implementação

**Atualizado:** 13/10/2026
**Estado:** implementação integrada na `main` e implantada em produção. A prova ponta a ponta com pauta/voz reais ainda está pendente; nenhum vídeo real foi produzido nesta validação.

## Estado atual

- PR [#1](https://github.com/jadiel054/estudio-canal-ia/pull/1) foi mesclado em 13/10/2026.
- Merge commit: `9955aecbcedc5f13000dcac92ff09f20bedef3bd`.
- Deployment de produção da Vercel: `dpl_GyPk5ARAzfebCW4BMSSCmr4mDqZn`, status `READY`, alias de produção `estudio-canal-ia.vercel.app`.
- O repositório está **público por decisão expressa do dono**; não é um bloqueio para prosseguir.
- O dono informou que cadastrou `GITHUB_ACTIONS_TOKEN` na Vercel Production e o mesmo `STUDIO_RENDER_HMAC_SECRET` na Vercel Production e no GitHub Actions. Esta sessão não consultou nem revelou valores; a disponibilidade runtime ainda deve ser conferida no painel de integrações.
- Os workflows `Render privado de vídeo` e `Limpar render publicado` estão ativos no GitHub. Não há execuções reais de render ou limpeza registradas até esta verificação.

## O que foi implementado

- **Voz:** adaptador Gemini TTS no servidor, modelos principal/fallback, configuração de voz, geração de amostra, validação de WAV e timeout. Interface suporta **TTS** ou **música + texto**. A amostra PT-BR ainda precisa ser ouvida e aprovada pelo dono. O Piper não foi habilitado: a licença comercial dos pesos PT-BR permanece insuficientemente esclarecida.
- **Entrada de mídia:** upload autenticado de até cinco capturas PNG/JPEG/WebP por roteiro aprovado, até 2 MB por arquivo e 8 MB por versão, com validação de conteúdo, hash e versão do roteiro. Os arquivos ficam no Neon.
- **Render real:** job transacional no Neon; GitHub Actions recebe somente UUID; manifesto mínimo e imutável é buscado por HMAC; worker FFmpeg/Pillow gera vídeo vertical 1080×1920 ou horizontal 1280×720, áudio/legendas e QA mecânico verificável.
- **Segurança:** callbacks HMAC com timestamp, método, caminho e bytes do corpo; verificação de status/versão, idempotência e confirmação do asset Release; download autenticado via servidor, sem URL pública permanente.
- **Portões:** render exige roteiro real com Portão 1 aprovado; Portão 2 exige MP4 real e QA verificável; aprovação, pedido de ajuste e rejeição são ações humanas.
- **Retenção:** MP4 em asset de GitHub Release draft. Depois de aprovação no Portão 2 e publicação manual, o dono pode solicitar limpeza; download é desativado e o workflow remove Release/tag daquele job. Publicação no YouTube continua manual.
- **Banco:** migração aditiva aplicada e verificada no Neon dedicado; tabelas: `studio_render_jobs`, `studio_render_inputs`, `studio_render_assets`, `studio_render_manifest_hashes` e `studio_render_callback_events`.

## Validação executada

Verificações repetidas após o merge, nesta retomada:

| Verificação | Resultado |
|---|---|
| `pnpm check` | passou |
| `pnpm test` | 15 arquivos, 74 testes passaram |
| `python3 -m unittest scripts.test_render_video` | 7 testes passaram |
| `pnpm build` | passou (Vite + bundle do servidor) |
| Smoke render FFmpeg local | MP4 H.264/AAC real, 1080×1920, QA mecânico aprovado (fixture local; não é prova de produção) |
| Preview da Vercel | `READY`, HTTP 200 usando acesso autenticado |
| Produção Vercel | `READY` no merge commit indicado acima |

O build informa avisos não bloqueantes sobre o script de configuração da plataforma não ser módulo e o chunk principal ultrapassar 500 kB. Não houve erro de TypeScript, testes ou build.

O smoke render é local e usa fixture/trilha procedural. Não acessou Neon, Gemini, GitHub, nem conteúdo do dono. A pipeline real está ligada ao comando de render; a execução do worker via workflow ainda aguarda a primeira prova assistida.

## O que falta para encerrar a Etapa C

Não há implementação de código pendente identificada no escopo aprovado. Falta a **prova ponta a ponta assistida**, que exige conteúdo e decisões do dono:

1. Conferir no painel de produção se Neon, token GitHub e HMAC aparecem configurados; não exibir nem copiar segredos. A amostra TTS exige a chave Gemini configurada, se o dono escolher TTS.
2. Escolher uma pauta curta, segura e publicável; criar/gerar o roteiro, verificar fontes e aprová-lo manualmente no **Portão 1**.
3. Se usar TTS, gerar e ouvir a amostra PT-BR; o dono decide se aceita a voz. O nível gratuito pode sujeitar inputs/outputs a uso para melhoria/revisão; não enviar dados sensíveis. Opção alternativa: música + texto.
4. Anexar capturas necessárias, sem dados pessoais ou credenciais.
5. **Antes do primeiro render real**, obter autorização explícita do dono. O job consome quota de GitHub Actions e cria um draft Release temporário. Iniciar um render e acompanhar até o QA.
6. Reproduzir e baixar o MP4. O dono avalia QA e conteúdo e decide manualmente o **Portão 2**.
7. Publicação permanece manual pelo dono. Só depois de confirmar a publicação, solicitar confirmação final para limpeza do draft e conferir o workflow GitHub Actions.

O roteiro completo, incluindo checkpoints e critério de aceite, está resumido no plano versionado em [`etapa-c-plano.md`](etapa-c-plano.md); o checklist operacional também foi preparado separadamente para esta retomada.

## Privacidade e voz

A documentação do Gemini informa que, no nível gratuito, inputs e outputs podem ser usados para melhoria de produtos e revisão humana. Não enviar segredos, dados pessoais ou material confidencial ao TTS gratuito. Uso profissional deve observar os termos aplicáveis; isso não garante exclusividade nem substitui revisão jurídica. A aceitação do sotaque brasileiro deve ser confirmada por amostra pelo dono.

## Referências

- [Termos adicionais da Gemini API](https://ai.google.dev/gemini-api/terms), [preços/nível gratuito](https://ai.google.dev/gemini-api/docs/pricing) e [Speech Generation](https://ai.google.dev/gemini-api/docs/speech-generation).
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) e [download de Release asset](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).
- [Dispatch de workflow](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) e [permissões de PAT fine-grained](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
- [Billing/limites do GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- [Discussão oficial sobre licença dos pesos Piper](https://huggingface.co/rhasspy/piper-voices/discussions/111).
