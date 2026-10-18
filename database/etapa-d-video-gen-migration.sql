-- Estúdio de Canal IA — Etapa D: Motor de Geração de Vídeo (híbrido)
-- Versão corrigida e aplicada no Neon em 2026-10-18.
-- Idempotente. Nenhuma chave/token aqui.

-- 1) Liga assets ao vídeo final
ALTER TABLE assets ADD COLUMN IF NOT EXISTS video_id BIGINT REFERENCES videos(id);

-- 2) Plano de cenas = saída do Diretor de IA após aprovação do Portão 1
CREATE TABLE IF NOT EXISTS shot_plans (
  id BIGSERIAL PRIMARY KEY,
  script_id BIGINT NOT NULL REFERENCES scripts(id),
  scene_number INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 8,
  description TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  camera_notes TEXT,
  audio_notes TEXT,
  reference_asset_id BIGINT REFERENCES assets(id),
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shot_plans_script_idx ON shot_plans (script_id, scene_number);
CREATE UNIQUE INDEX IF NOT EXISTS shot_plans_script_scene_unique ON shot_plans (script_id, scene_number);

-- 3) Fila de geração por cena
CREATE TABLE IF NOT EXISTS video_gen_jobs (
  id BIGSERIAL PRIMARY KEY,
  shot_plan_id BIGINT NOT NULL REFERENCES shot_plans(id),
  video_id BIGINT REFERENCES videos(id),
  provider TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'i2v',
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  reference_asset_id BIGINT REFERENCES assets(id),
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  provider_job_id TEXT,
  output_asset_id BIGINT REFERENCES assets(id),
  estimated_cost NUMERIC(10,4) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(10,4) NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS video_gen_jobs_status_idx ON video_gen_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS video_gen_jobs_shot_plan_idx ON video_gen_jobs (shot_plan_id);

-- 4) Seeds de adapters (idempotente)
INSERT INTO adapters (capability, provider, plan, active, priority, config)
SELECT * FROM (VALUES
  ('video_gen', 'wan_selfhosted', 'selfhosted', FALSE, 1, '{"endpoint_env":"WAN_API_URL","gpu_min_vram_gb":24,"notes":"Wan2.2 TI2V-5B self-hosted"}'::jsonb),
  ('video_gen', 'seedance_api', 'paid', FALSE, 2, '{"endpoint_env":"SEEDANCE_API_URL","notes":"Modo qualidade"}'::jsonb),
  ('video_gen', 'pixverse_api', 'freemium', FALSE, 3, '{"notes":"Fallback freemium"}'::jsonb),
  ('video_gen', 'kling_api', 'paid', FALSE, 4, '{"notes":"Fallback pago"}'::jsonb),
  ('image_gen', 'wan_i2v_frames', 'selfhosted', FALSE, 1, '{"notes":"Frames de referência consistentes"}'::jsonb),
  ('image_gen', 'flux_schnell', 'selfhosted', FALSE, 2, '{"notes":"Geração local de frames"}'::jsonb)
) AS v(capability, provider, plan, active, priority, config)
WHERE NOT EXISTS (
  SELECT 1 FROM adapters a
  WHERE a.capability = v.capability AND a.provider = v.provider
);
