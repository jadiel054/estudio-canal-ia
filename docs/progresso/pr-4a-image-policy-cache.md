# PR-4A — política visual, adapter e cache

**Status:** implementação local em branch dedicada; não mesclada. A migration é aditiva e permanece sem aplicação. Nenhuma consulta ao Neon foi executada.

## Escopo entregue

- Política versionada no servidor: candidato `cloudflare_workers_ai` / `@cf/black-forest-labs/flux-2-klein-4b`, com revisão interna fixa `provider-alias-unpinned-v1`.
- O alias remoto não é uma revisão imutável confirmada. A política mantém `generationAllowed`, revisão pinada, licença, termos e custo efetivo bloqueados/desconhecidos; `STUDIO_IMAGE_GENERATION_ENABLED` também é necessário e vem desligado por padrão.
- Adapter testável com provider injetável, sem transporte HTTP real incluído nesta PR. A instância de servidor não recebe provider.
- Cache SHA-256 vinculado a direção visual, preset/versão, provider/modelo/revisão e dimensões; somente hashes/metadados allowlisted são persistidos.
- Validação pré-persistência de assinatura/MIME, dimensões exatas, limite de bytes e SHA-256 para PNG, JPEG e WebP.
- `studio_image_cache` e `studio_image_usage`; hit/miss, bloqueios e geração são auditáveis sem prompt bruto.
- Reserva de quota/orçamento em transação, lock advisory por vídeo, unique index parcial para single-flight distribuído, máximo de oito gerações por vídeo (teto estrutural 12), duas tentativas por cache key e orçamento interno de US$ 0,50 por vídeo. Os limites não autorizam gasto: custo desconhecido bloqueia reserva.
- O cadastro em `adapters` é semeado como `active=false` e `plan=unverified`.

## Limites mantidos

- Não houve chamada a provider de imagem/LLM/TTS, render, deploy, consulta ou migration no Neon, alteração de produção, clique na UI, merge ou publicação.
- O módulo não está conectado ao fluxo do worker nesta PR; seleção de assets/fallback e integração visual pertencem à PR-4B.
- A ativação real exige confirmar licença/termos, versão realmente pinável, custo/quota e autorização específica do dono; não basta ligar a variável de ambiente nem ativar a linha do banco.

## Validação

- `pnpm check`: passou.
- `pnpm test`: 29 arquivos, 203 testes passaram.
- `python3 -m unittest discover -s scripts -p 'test_render_video.py'`: 21 testes passaram.
- `pnpm build`: passou (client e server). Permanecem avisos não bloqueantes preexistentes de `/api/platform/config.js` e do bundle client acima de 500 kB.
- Todos os testes novos usam provider e banco simulados; nenhum serviço externo foi chamado.
