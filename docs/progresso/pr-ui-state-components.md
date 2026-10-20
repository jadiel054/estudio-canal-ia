# PR 2 — Componentes de estado

**Branch:** `fix/ui-state-components`
**Data:** 2026-10-20
**Objetivo:** padronizar loading, vazio, erro, retry, confirmação e sync; ErrorBoundary em PT-BR; migrar Radar como piloto.

## Componentes (`client/src/components/state/`)
- `LoadingState`, `EmptyState`, `ErrorState` (sanitizado, código de suporte)
- `AsyncState` (orquestra os três)
- `SyncStatus` (lastSyncedAt + refresh)
- `RetryButton`, `MutationButton` (loading + anti double-click básico)
- `ConfirmAction` (confirmação em duas etapas)

## Outros
- `ErrorBoundary` — PT-BR, sem stack na UI, código de suporte
- `RadarPage` — usa `AsyncState`, `SyncStatus` e `MutationButton`

## Fora de escopo
Refresh global, verdade visual Analytics, upload/preview, Playwright (PRs 3–6).
