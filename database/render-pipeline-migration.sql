-- Etapa C: jobs, capturas de entrada e assets reais de render. Aditiva; não altera tabelas existentes.
-- Aplicar somente no projeto Neon misty-dust-45555125 (estudio-canal-ia).

CREATE TABLE IF NOT EXISTS studio_render_jobs (
  id UUID PRIMARY KEY,
  video_id TEXT NOT NULL,
  idea_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  script_version INTEGER NOT NULL CHECK (script_version > 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'qa', 'succeeded', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  workflow_run_id BIGINT,
  release_id BIGINT,
  asset_id BIGINT,
  file_name TEXT,
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  duration_seconds NUMERIC(10, 3) CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  qa JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS studio_render_jobs_recent_idx ON studio_render_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS studio_render_jobs_script_idx ON studio_render_jobs (script_id, script_version, created_at DESC);
CREATE INDEX IF NOT EXISTS studio_render_jobs_status_idx ON studio_render_jobs (status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS studio_render_jobs_one_active_per_script_idx
  ON studio_render_jobs (script_id, script_version)
  WHERE status IN ('queued', 'rendering', 'qa');

CREATE TABLE IF NOT EXISTS studio_render_inputs (
  id UUID PRIMARY KEY,
  idea_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  script_version INTEGER NOT NULL CHECK (script_version > 0),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 2097152),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_render_inputs_script_idx ON studio_render_inputs (script_id, script_version, created_at DESC);

CREATE TABLE IF NOT EXISTS studio_render_assets (
  id UUID PRIMARY KEY,
  script_id TEXT NOT NULL,
  script_version INTEGER NOT NULL CHECK (script_version > 0),
  github_release_id BIGINT NOT NULL,
  github_asset_id BIGINT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  label TEXT NOT NULL,
  license TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (github_asset_id)
);
CREATE INDEX IF NOT EXISTS studio_render_assets_script_idx ON studio_render_assets (script_id, script_version, created_at DESC);

CREATE TABLE IF NOT EXISTS studio_render_manifest_hashes (
  job_id UUID PRIMARY KEY REFERENCES studio_render_jobs(id) ON DELETE CASCADE,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio_render_callback_events (
  event_id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES studio_render_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('rendering', 'qa', 'failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS studio_render_callback_events_job_idx ON studio_render_callback_events (job_id, received_at DESC);
