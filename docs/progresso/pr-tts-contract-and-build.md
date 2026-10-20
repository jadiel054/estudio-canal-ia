# PR 1 — Contrato TTS e build

**Branch:** `fix/tts-contract-and-build`  
**Data:** 2026-10-20  
**Objetivo:** fechar o contrato entre UI e router TTS.

## Mudanças
- `server/ttsContract.ts` — tipos públicos + getTtsSettingsResponse + generateTtsSample
- `server/routers.ts` — settings com configured; test para amostra; remove z.enum inválido
- `client/.../TTSProviderSettings.tsx` — guards de modelo/voz

## Validar
```bash
pnpm check && pnpm test -- server/ttsProvider.test.ts && pnpm build
```
