# PR-1B — fluxo OAuth YouTube server-side

A PR implementa state aleatório de uso único com hash e TTL, troca de authorization code no servidor, validação estrita do escopo `https://www.googleapis.com/auth/youtube.readonly`, descoberta de um canal via `channels.list(mine=true, part=snippet)`, armazenamento de tokens cifrados com AES-256-GCM, refresh protegido por lock advisory e revogação local/remota idempotente.

A UI não recebe tokens. O status devolvido pelo tRPC contém apenas conectado/não conectado/erro, nome sanitizado do canal e timestamps. Erros de callback são reduzidos a códigos allowlisted e não carregam resposta do Google, code, state ou token.

**URI fixa para cadastrar no Google Cloud:** `https://estudio-canal-ia.vercel.app/api/integrations/youtube/callback`

O fluxo depende da migration da PR-1A, ainda não aplicada. Não houve teste OAuth real, upload, endpoint de escrita, publicação nem uso de Client ID/Secret da conta. Os testes usam fetch e pool simulados.

Validação local: `pnpm check` passou; `server/youtubeOAuth.test.ts` passou com 4 testes.
