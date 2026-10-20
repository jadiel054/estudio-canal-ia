# PR 3 — Refresh e invalidação

**Branch:** `fix/refresh-invalidation`
**Data:** 2026-10-20

## Objetivo
Dados deixam de ficar stale silenciosos: focus da janela, volta à aba e botão global de atualizar.

## Mudanças
- `client/src/lib/queryClient.ts` — defaults (`refetchOnWindowFocus`, `staleTime`)
- `client/src/lib/studioRefresh.ts` — `invalidateStudioQueries` por domínio
- `client/src/main.tsx` — usa `createAppQueryClient`
- `client/src/components/StudioShell.tsx` — `GlobalSyncBar` (SyncStatus + visibility + refresh manual)
- `client/src/store/StudioStore.tsx` — `refetchOnWindowFocus: true` no `studio.state`

## Fora de escopo
Verdade visual Analytics, upload/preview, Playwright.
