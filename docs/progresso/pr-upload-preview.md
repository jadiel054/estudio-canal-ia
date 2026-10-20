# PR 5 — Upload e preview

**Branch:** `fix/upload-preview`
**Data:** 2026-10-20

## Componentes
- `ImageUploadField` — preview, progresso de leitura, MIME/tamanho/dimensão, retry
- `VideoPreviewPlayer` — erro recuperável + download fallback

## Integração no Estúdio
Substituir o `<input type="file">` de captura e os `<video src=/api/render/preview/...>` do `StudioPage` / fila por estes componentes (pode ser commit de follow-up ou Jules).

## Fora de escopo
Mudança de contrato do `uploadRenderInput`, pipeline FFmpeg, Playwright.
