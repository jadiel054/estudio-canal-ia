-- PR-4A: cache e auditoria de imagens visuais geradas.
-- Migration aditiva; este arquivo é entregue para revisão e NÃO foi aplicado em nenhum Neon.
-- Não armazena prompt bruto, resposta do provider, segredo ou conteúdo editorial em logs.

CREATE TABLE IF NOT EXISTS studio_image_cache (
  cache_key CHAR(64) PRIMARY KEY CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  prompt_hash CHAR(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 80),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 160),
  model_revision TEXT NOT NULL CHECK (length(model_revision) BETWEEN 1 AND 120),
  preset TEXT NOT NULL CHECK (preset IN ('tutorial-visual-v1')),
  preset_version TEXT NOT NULL CHECK (length(preset_version) BETWEEN 1 AND 40),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  image_bytes BYTEA NOT NULL CHECK (octet_length(image_bytes) BETWEEN 16 AND 8388608),
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count BIGINT NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  last_accessed_at TIMESTAMPTZ,
  CHECK (width::BIGINT * height::BIGINT <= 16777216)
);

CREATE INDEX IF NOT EXISTS studio_image_cache_expiry_idx
  ON studio_image_cache (expires_at);
CREATE INDEX IF NOT EXISTS studio_image_cache_prompt_hash_idx
  ON studio_image_cache (prompt_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS studio_image_usage (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('cache_hit', 'cache_miss', 'generation', 'blocked', 'singleflight_wait', 'fallback')),
  status TEXT NOT NULL CHECK (status IN ('observed', 'reserved', 'success', 'failure', 'blocked', 'expired', 'in_flight')),
  cache_key CHAR(64) NOT NULL CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  prompt_hash CHAR(64) NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 80),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 160),
  model_revision TEXT NOT NULL CHECK (length(model_revision) BETWEEN 1 AND 120),
  preset TEXT NOT NULL CHECK (preset IN ('tutorial-visual-v1')),
  preset_version TEXT NOT NULL CHECK (length(preset_version) BETWEEN 1 AND 40),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) <= 200),
  video_id TEXT NOT NULL CHECK (length(video_id) BETWEEN 1 AND 200),
  section_index INTEGER NOT NULL CHECK (section_index BETWEEN 0 AND 79),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN (
    'feature_disabled', 'policy_disabled', 'license_unconfirmed', 'terms_unconfirmed',
    'model_revision_unpinned', 'cost_unknown', 'adapter_inactive', 'provider_unconfigured',
    'video_quota', 'attempt_quota', 'budget_exceeded', 'invalid_mime', 'mime_mismatch',
    'invalid_image_bytes', 'invalid_dimensions', 'dimension_mismatch', 'size_exceeded',
    'unsupported_mime', 'provider_failure', 'storage_unavailable', 'cache_corrupt',
    'invalid_request', 'reservation_expired'
  )),
  http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  estimated_cost_usd NUMERIC(12, 8) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  actual_cost_usd NUMERIC(12, 8) CHECK (actual_cost_usd IS NULL OR actual_cost_usd >= 0),
  reservation_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK ((event_type = 'generation' AND status = 'reserved') = (reservation_expires_at IS NOT NULL)),
  CHECK (event_type = 'generation' OR status <> 'reserved')
);

CREATE INDEX IF NOT EXISTS studio_image_usage_created_at_idx
  ON studio_image_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS studio_image_usage_video_idx
  ON studio_image_usage (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS studio_image_usage_cache_key_idx
  ON studio_image_usage (cache_key, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS studio_image_usage_singleflight_idx
  ON studio_image_usage (cache_key)
  WHERE event_type = 'generation' AND status = 'reserved';

-- Identidade/versionamento alinhados ao código e desligados até revisão de licença,
-- termos, pinagem do modelo e custo. Não habilitar por editar somente esta linha.
INSERT INTO adapters (capability, provider, plan, active, priority, config)
SELECT 'image_generation', 'cloudflare_workers_ai', 'unverified', FALSE, 1,
       jsonb_build_object(
         'policy_version', 'studio-image-policy-v1',
         'model', '@cf/black-forest-labs/flux-2-klein-4b',
         'model_revision', 'provider-alias-unpinned-v1'
       )
WHERE NOT EXISTS (
  SELECT 1 FROM adapters
   WHERE capability = 'image_generation'
     AND provider = 'cloudflare_workers_ai'
     AND config->>'policy_version' = 'studio-image-policy-v1'
);
