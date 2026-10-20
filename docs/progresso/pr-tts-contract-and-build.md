# PR 1 — Contrato TTS e build

**Branch:** `fix/tts-contract-and-build`  
**Data:** 2026-10-20  
**Objetivo:** fechar o contrato entre UI e router TTS, eliminar deriva de tipos e garantir que settings / testConnection / sample fiquem estáveis.

## Mudanças

### `server/ttsProvider.ts`
- Tipos públicos: `TtsSettingsResponse`, `TtsSampleResponse`, `TtsVoice`
- `TTS_DATA_POLICY` centralizado
- `getTtsSettingsResponse()` — settings + `configured` + política, sem segredo
- `generateTtsSample()` — amostra com formato fixo para a UI

### `server/routers.ts`
- `tts.settings` usa `getTtsSettingsResponse()`
- `tts.test` usa `generateTtsSample()` (mantido o nome `test` por compatibilidade com a UI)
- Removida montagem ad-hoc de payload no router

### `client/src/components/TTSProviderSettings.tsx`
- Guards de modelo/voz (`toDraft`) em vez de `as` casts
- Mutation de amostra renomeada localmente para `sample` (ainda chama `trpc.tts.test`)
- Feedback de loading/erro/sucesso preservado; `ObjectURL` continua sendo revogado

### Testes
- Novos casos em `server/ttsProvider.test.ts`:
  - schema aceita/rejeita
  - `getTtsSettingsResponse` com e sem chave
  - `generateTtsSample` no formato da UI

## Fora de escopo
- ErrorBoundary, Analytics, refresh global, upload, video-gen
- Alterações de Portão 1.5 (ficaram no stash `wip-portao-1.5`)

## Como validar
```bash
pnpm check
pnpm test -- server/ttsProvider.test.ts
pnpm build
```
