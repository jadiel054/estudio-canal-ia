-- Persistência de status HTTP estruturados em falhas do render.
-- Aditiva e idempotente; não grava mensagens, conteúdo editorial, prompts ou segredos.
ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS http_status INTEGER;
ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS upstream_status INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studio_render_jobs_http_status_check'
      AND conrelid = 'public.studio_render_jobs'::regclass
  ) THEN
    ALTER TABLE public.studio_render_jobs
      ADD CONSTRAINT studio_render_jobs_http_status_check
      CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studio_render_jobs_upstream_status_check'
      AND conrelid = 'public.studio_render_jobs'::regclass
  ) THEN
    ALTER TABLE public.studio_render_jobs
      ADD CONSTRAINT studio_render_jobs_upstream_status_check
      CHECK (upstream_status IS NULL OR upstream_status BETWEEN 100 AND 599);
  END IF;
END
$$;
