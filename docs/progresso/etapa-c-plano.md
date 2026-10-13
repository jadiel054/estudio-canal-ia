# Etapa C — plano de produção real de vídeo

**Estado:** planejamento e primeira fundação de segurança iniciados em 13/10/2026. A etapa ainda não está implantada nem concluída.

## Voz e uso comercial

Recomendação inicial: **Gemini 3.8 Flash TTS** como voz principal e **Gemini 3.8 Flash-Lite TTS** como fallback de menor latência. A tabela oficial de preços marca ambos com entrada e áudio gratuitos no nível gratuito da Gemini API. O Flash TTS lista suporte a português entre mais de 130 idiomas e anuncia cobertura de sotaques regionais; a documentação não garante especificamente o sotaque brasileiro. A aceitação final de PT-BR precisa de uma amostra curta ouvida pelo dono antes de habilitar a produção. [1] [2]

Os termos adicionais do Google dizem que o serviço é para uso profissional ou empresarial, que o Google não reivindica propriedade do conteúdo gerado e que o usuário é responsável pelo uso. Isso permite considerar o TTS para um canal monetizado, mas **não equivale a uma garantia de exclusividade nem a um parecer jurídico**. No nível gratuito, inputs e outputs podem ser usados para melhoria dos produtos e podem ser revisados por pessoas; por isso, não enviar segredos, material confidencial ou dados pessoais. A narração pode usar apenas roteiro já aprovado e não deve incluir credenciais. [3]

O Piper pt_BR Cadu permanece **não aprovado para monetização nesta implementação**. O cartão declara CC0 para o dataset e informa fine-tuning a partir da voz Lessac; a página da coleção mostra MIT, mas uma discussão oficial ainda pede esclarecimento sobre a licença dos pesos, a relação com o modelo-base e o uso comercial. Não encontrei confirmação do mantenedor que feche essas lacunas. [4] [5] Portanto, o fallback seguro será Flash-Lite e, se ambos falharem, “música + texto”/erro recuperável — não uma voz Piper sem licença confirmada.

## Render e armazenamento

Proposta: o painel cria um job apenas para roteiro aprovado no Neon; Vercel despacha `workflow_dispatch` para GitHub Actions. O runner busca um manifesto assinado e mínimo, renderiza com FFmpeg, envia progresso/resultado autenticado por HMAC e publica o MP4 como **asset de um GitHub Release em rascunho**. O rascunho permanece privado a quem tem permissão de escrita no repositório; o painel consulta o asset autenticado para prévia e exportação. Após o download/expiração definida, o release/asset deve ser removido para não acumular material temporário. [6] [7]

Escolho Releases em rascunho em vez de artifacts para a prova: cada arquivo de Release deve ter menos de 2 GiB; a documentação não estabelece limite para o tamanho total de um Release nem para banda. Em contraste, GitHub Free inclui 500 MB de armazenamento de artifacts compartilhado com Packages e 2.000 minutos/mês para repositórios privados. Os limites e a política podem mudar; não declarar custo zero garantido se a conta passar da franquia. [6] [8]

O workflow deve usar permissões mínimas: o `GITHUB_TOKEN` efêmero da execução recebe `contents: write` somente para criar o rascunho/anexar o MP4. O PAT fino guardado no Vercel serve para despachar/consultar Actions e acessar o asset: acesso somente ao repositório `jadiel054/estudio-canal-ia`, `Actions: read/write` e `Contents: read`. O despacho oficial aceita arquivo do workflow ou ID e exige `Actions: write` para token fine-grained. [9] [10]

O manifesto nunca deve ir como JSON visível nos logs ou como input de workflow: enviará apenas o ID do job; o runner buscará do Vercel o roteiro aprovado, texto de voz, legendas e referências validadas. HMAC no callback usará timestamp, corpo bruto, janela curta anti-replay e comparação em tempo constante. O servidor recarregará o estado do Neon antes de aceitar conclusão ou aprovar o vídeo. Erro, job repetido ou callback inválido não pode avançar o Portão 2.

## Lacunas a implementar

1. Adaptador TTS de servidor com modelos configuráveis, fallback, timeout, tratamento de quota e registro de uso; teste curto em PT-BR antes de selecionar a voz definitivamente.
2. Upload/armazenamento limitado para capturas e assets de entrada. Hoje o cliente guarda URLs de referência, mas não há fluxo de upload real para arquivos de produção.
3. Tabela de jobs com `jobId`, versões do roteiro, status, progresso, IDs do workflow/Release/asset e expiração; manifesto imutável só é emitido após validar aprovação no Neon.
4. Endpoint tRPC autenticado para iniciar job, endpoints internos para manifesto/status/asset e callback HMAC com idempotência.
5. Workflow de GitHub Actions, FFmpeg e legendas; arquivo de saída de verdade, QA verificável (duração, streams, legenda e tamanho), prévia no painel e download autenticado.
6. Reescrever o comando atual `startRender`, que ainda é explicitamente simulado; nenhum sucesso, QA ou URL será fabricado. Portão 2 só aceitará um MP4 real e QA concluído.
7. Fluxo “pedir ajuste” com versão nova e limpeza do asset anterior sem tocar na aprovação do roteiro; manter publicação manual, sem upload ao YouTube nesta etapa.

## Bloqueios para a prova ponta a ponta

- O repositório está **público neste momento**. Não vou enviar roteiro, capturas ou vídeo para uma execução real enquanto essa visibilidade não for deliberadamente alterada para privada pelo dono. Releases em rascunho limitam a leitura a quem tem escrita, mas manter o projeto privado é a escolha mais segura para produção.
- O GitHub CLI não tem permissão para ler Actions Secrets neste repositório (retorno 403); não tentei contornar isso nem revelar tokens. Ainda será necessário configurar, sem compartilhar no chat, um PAT fine-grained somente para este repositório no ambiente Production da Vercel e um mesmo segredo HMAC no Vercel e em Actions Secrets.
- A prova deverá usar uma pauta real, com roteiro aprovado no Portão 1 e capturas/código que o dono escolha. Dados de demonstração não serão tratados como insumo real.

**Não alterei visibilidade, permissões, segredos nem tabelas Neon nesta primeira fundação.** A próxima rodada pode implementar o contrato de jobs, callbacks e worker depois de concluirmos o teste do adaptador TTS e o fluxo de entrada de assets.

## Referências

[1]: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts "Modelo Gemini 3.8 Flash TTS e idiomas"
[2]: https://ai.google.dev/gemini-api/docs/pricing "Preços oficiais da Gemini API e nível gratuito"
[3]: https://ai.google.dev/gemini-api/terms "Termos adicionais da Gemini API"
[4]: https://huggingface.co/rhasspy/piper-voices/blob/main/pt/pt_BR/cadu/medium/MODEL_CARD "Cartão do modelo Piper Cadu pt_BR"
[5]: https://huggingface.co/rhasspy/piper-voices/discussions/111 "Discussão sobre licença comercial dos pesos Piper Cadu e Faber"
[6]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases "GitHub Releases: visibilidade e limites de assets"
[7]: https://docs.github.com/en/rest/releases/assets#get-a-release-asset "Download de asset de Release pela API"
[8]: https://docs.github.com/en/billing/concepts/product-billing/github-actions "Franquias e faturamento do GitHub Actions"
[9]: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event "Disparo de workflow via REST API"
[10]: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens "Permissões de PAT fine-grained"
