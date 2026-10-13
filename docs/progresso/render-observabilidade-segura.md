# Observabilidade segura do render

**Data:** 13/10/2026
**Branch:** `feat/render-safe-observability`

## Objetivo

Tornar a próxima falha do pipeline diagnosticável por operação e código estável, sem registrar mensagem livre, texto do roteiro, bytes/áudio, credenciais ou conteúdo de respostas externas.

## Implementação

- O endpoint `/api/render` registra um evento JSON com operação allowlisted, código de erro e status HTTP numéricos. A resposta expõe o código em `X-Render-Error-Code` e, quando aplicável, o status do provedor em `X-Render-Upstream-Status`.
- O worker lê esses cabeçalhos, não lê o body de uma resposta HTTP de erro e não imprime `str(exc)` nem stderr do FFmpeg. Seu log de falha contém somente `event`, operação, código e status numéricos.
- O callback do worker transmite apenas `errorOperation`, `errorCode`, `httpStatus` e `upstreamStatus`; mensagens livres não são usadas em callbacks de falha.
- O servidor valida esses campos contra enums/ranges, cria um resumo sanitizado e o persiste no job e no audit log. O schema Zod preserva a operação/status no estado do estúdio, e a interface já mostra o resumo do job.
- O timeout do Gemini TTS agora tem código distinto (`tts_timeout`), separado de indisponibilidade e falha de rede.
- Não há migração SQL: `error_code` e `error_message` existentes continuam sendo usados; operação e status complementares são guardados no estado JSON e no audit log.

## Validação local

| Verificação | Resultado |
|---|---|
| `pnpm test` | 94 testes aprovados |
| `python3 -m unittest scripts.test_render_video` | 10 testes aprovados, incluindo smoke test local de MP4 com FFmpeg |
| `pnpm check` | Aprovado |
| `pnpm build` | Concluído; avisos Vite sobre tag de script não-module e bundle principal acima de 500 kB |
| Allowlist Python/TypeScript | 30 códigos em cada lado, sem diferenças |

## Limites

Esta alteração **não foi implantada**, não alterou secrets e não criou nem repetiu jobs de render. A observabilidade só poderá ser confirmada em execução real depois de a mudança ser mesclada e implantada; qualquer novo render permanece sujeito à autorização do dono.
