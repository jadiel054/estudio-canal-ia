# PR-4B — manifesto v2, worker visual e fallback

**Status:** implementação local em branch dedicada; sem merge. O provider real permanece bloqueado, sem render gerativo, sem gasto e sem ação de produção.

## Escopo entregue

- Manifesto versionado com `workerContractVersion=2`, descriptors visuais seguros e rollout compatível com manifests v1.
- Descriptor contém somente asset id, seção, origem, endpoint interno assinado, hash, dimensões e foco; não inclui prompt, segredo, token, direção visual bruta ou Nota de produção.
- Endpoint HMAC `op=image` serve somente imagem cacheada vinculada ao job ativo, com hash, MIME e assinatura de resposta.
- Seleção visual determinística por `sectionIndex`: captura real → imagem gerada cacheada e aprovada → focus frame. Captura genérica é usada no máximo no primeiro cue.
- Capturas usam `ImageOps.contain`; dimensões e contexto não são cortados.
- `source_kind` e `synthetic` são registrados nos descriptors (`real_capture`/`generated_image`); a origem cacheada gerada é sintética.
- `motionPreset=none` é default e fallback. `ken_burns_v1`, quando explicitamente presente, é determinístico, limitado a zoom máximo 1,06× e pan normalizado máximo de 3%.
- Safe area versionada no manifesto; o worker rejeita descriptors inseguros e mantém a composição sem crop indevido.
- QA v2 acrescenta `visual_layout`, `production_notes_excluded` e FPS/pixel format via `ffprobe`. O servidor exige esses checks quando o worker declara contrato v2; manifests/callbacks v1 continuam compatíveis.
- A decisão vigente foi preservada: cache gerado aprovado continua elegível no manifesto mesmo com feature flag de geração desligada. A política de servir cache com feature desligada fica anotada para revisão na integração.

## Guardrails

- Nenhuma chamada ao provider Cloudflare, nenhum render gerativo, nenhum gasto, nenhuma migration adicional, nenhum deploy manual e nenhuma ação na UI.
- O worker só chama endpoints internos assinados. Os testes usam fixtures, mocks e FFmpeg/Pillow local.
- O provider/modelo continua bloqueado por licença, termos, pinagem e custo não confirmados.
- O fallback permanece disponível quando não há captura ou imagem gerada cacheada.

## Validação

- `pnpm check`: passou.
- `pnpm test`: 29 arquivos, 204 testes passaram.
- `python3 -m unittest discover -s scripts -p 'test_render_video.py'`: 24 testes passaram, incluindo manifesto v2, descriptors, Ken Burns determinístico, fallback e QA v2.
- `pnpm build`: client e server passaram. Permanecem os avisos não bloqueantes já existentes sobre `/api/platform/config.js` sem `type="module"` e bundle client acima de 500 kB.
- `py_compile` e `git diff --check`: passaram.
- Nenhum provider, serviço externo de imagem, render gerativo, gasto ou ação de produção foi executado.
