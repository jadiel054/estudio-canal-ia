# Etapa C — plano de produção real de vídeo

**Estado:** escopo técnico implementado, mesclado na `main` e implantado em produção. O deployment `dpl_GyPk5ARAzfebCW4BMSSCmr4mDqZn` está `READY` no commit `9955aecbcedc5f13000dcac92ff09f20bedef3bd`. A única atividade de encerramento é a prova ponta a ponta assistida com conteúdo real, ainda não iniciada.

O relatório de implementação, testes e próximos passos está em [`etapa-c-progresso.md`](etapa-c-progresso.md). Nenhum workflow real de render/limpeza foi executado nesta validação.

## Voz e uso comercial

A implementação usa Gemini Flash TTS como voz principal e Flash-Lite TTS como fallback, condicionados à disponibilidade e configuração da chave. O uso de TTS exige amostra curta em português brasileiro ouvida e aceita pelo dono. A documentação consultada informa possibilidade de uso profissional nos termos aplicáveis, mas não garante exclusividade nem substitui revisão jurídica. No nível gratuito, inputs e outputs podem ser usados para melhoria e revisão; não enviar dados pessoais ou conteúdo confidencial.

O Piper pt_BR Cadu permanece não aprovado para monetização nesta implementação. A licença comercial dos pesos não foi esclarecida pelas fontes consultadas; por isso, as alternativas seguras implementadas são fallback Gemini ou música + texto.

## Arquitetura entregue

- Jobs transacionais no Neon, conectados a roteiro real e versão aprovada no Portão 1.
- Despacho de workflow GitHub Actions passando somente UUID do job; runner busca manifesto imutável e assinado via endpoint HMAC.
- Worker Ubuntu com FFmpeg e Pillow, saída H.264/AAC vertical ou horizontal, narração ou música procedural, legendas e QA mecânico.
- Callback com HMAC, anti-replay e idempotência; QA e asset Release conferidos antes de liberar o Portão 2.
- Capturas limitadas, validadas por assinatura de arquivo e hash, em armazenamento privado no Neon.
- Download autenticado via aplicação; saída temporária em GitHub Release draft; workflow de limpeza direcionado à tag/Release do job.
- Portões 1 e 2 preservados como aprovações humanas; publicação no YouTube continua manual.

## Encerramento operacional — prova ponta a ponta

1. Conferir no painel de produção os estados de Neon, `GITHUB_ACTIONS_TOKEN` e `STUDIO_RENDER_HMAC_SECRET`, sem ler valores secretos. O dono informou que configurou token e HMAC; a chave de Gemini para TTS deve ser confirmada se esse modo for escolhido.
2. Selecionar uma pauta segura, gerar/revisar roteiro e aprovar manualmente no Portão 1.
3. Gerar e ouvir amostra PT-BR, se TTS for usado; caso contrário escolher música + texto. O dono aceita ou rejeita a voz.
4. Enviar apenas capturas necessárias e seguras.
5. Solicitar confirmação explícita do dono antes de iniciar um render real, que consome minutos/quota de Actions e cria um Release draft temporário.
6. Conferir o MP4 completo, download e QA. O dono decide o Portão 2.
7. O dono publica manualmente. Após confirmação, solicitar autorização para limpar o draft e validar o workflow de limpeza.

**Critério de conclusão:** job real bem-sucedido; QA conferido; Portões 1 e 2 aprovados pelo dono; download validado; publicação manual confirmada; limpeza de Release/tag confirmada. Nenhum desses passos de produção foi executado por esta atualização.

## Limites e custo

- Preferir opções gratuitas e validar quotas antes de executar. O nível gratuito não implica custo zero garantido em qualquer volume; respeitar limites de Gemini e Actions.
- Não enviar segredos nem dados sensíveis ao TTS gratuito.
- Não gerar/publicar automaticamente nem contornar os Portões 1 e 2.
- A visibilidade pública do repositório foi escolhida pelo dono e permanece intencional; não alterá-la nesta etapa.

## Referências consultadas no planejamento

- [Termos adicionais da Gemini API](https://ai.google.dev/gemini-api/terms), [preços](https://ai.google.dev/gemini-api/docs/pricing) e [Speech Generation](https://ai.google.dev/gemini-api/docs/speech-generation).
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [release assets](https://docs.github.com/en/rest/releases/assets#get-a-release-asset), [workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) e [permissões PAT](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
- [Limites de GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- [Discussão da licença Piper pt_BR](https://huggingface.co/rhasspy/piper-voices/discussions/111).
