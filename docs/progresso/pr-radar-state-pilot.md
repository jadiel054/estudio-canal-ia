# PR 2b — Radar piloto com componentes de estado

**Branch:** `fix/radar-state-pilot`
**Data:** 2026-10-20

Migrar `RadarPage` para usar `AsyncState`, `SyncStatus` e `MutationButton` após a base (#34).

## Mudança
- Import dos componentes de `@/components/state`
- Header com `SyncStatus` + `MutationButton` no atualizar
- Estados de loading e erro via `AsyncState` (código `RADAR_QUERY_FAILED`)

## Fora de escopo
Refresh global, Analytics, upload.
