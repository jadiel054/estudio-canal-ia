# PR 4 — Verdade visual

**Branch:** `fix/visual-truth`
**Data:** 2026-10-20

## Objetivo
Remover a aparência de funcionalidade onde ainda não há backend real.

## Mudanças
- `AnalyticsPage` — empty state honesto; sem gráficos/métricas fictícias
- `LivesPage` — rótulo de protótipo; toast deixa claro que é rascunho local
- `LogsPage` — custo "não medido" em vez de R$ 0,00 como se fosse medição
- `App.tsx` — rotas `/analytics`, `/lives`, `/logs` usam as novas páginas

## Fora de escopo
Upload/preview, Playwright, extrair todo o Workspace.
