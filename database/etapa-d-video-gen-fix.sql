-- Etapa D fix: anti-duplicata + custo nos adapters
-- Aplicado no Neon em 2026-10-18. Idempotente.

-- 1) Unique parcial: no máximo 1 job ativo (queued/running) por cena
CREATE UNIQUE INDEX IF NOT EXISTS video_gen_jobs_one_active_per_scene
  ON video_gen_jobs (shot_plan_id)
  WHERE status IN ('queued', 'running');

-- 2) cost_per_second + currency nos configs dos adapters de video_gen
UPDATE adapters SET config = config || '{"cost_per_second": 0.01, "currency": "USD"}'::jsonb
WHERE capability = 'video_gen' AND provider = 'wan_selfhosted';

UPDATE adapters SET config = config || '{"cost_per_second": 0.08, "currency": "USD"}'::jsonb
WHERE capability = 'video_gen' AND provider = 'seedance_api';

UPDATE adapters SET config = config || '{"cost_per_second": 0.04, "currency": "USD", "endpoint_env": "PIXVERSE_API_KEY"}'::jsonb
WHERE capability = 'video_gen' AND provider = 'pixverse_api';

UPDATE adapters SET config = config || '{"cost_per_second": 0.06, "currency": "USD", "endpoint_env": "KLING_API_KEY"}'::jsonb
WHERE capability = 'video_gen' AND provider = 'kling_api';
