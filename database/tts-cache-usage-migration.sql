-- Cache efêmero de áudio Gemini TTS + métricas estruturadas de chamadas.
-- Aditiva: não modifica tabelas ou registros já existentes.
-- Cache e métricas não armazenam roteiro, prompt, resposta bruta, áudio de usuário ou segredo.

ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS quota_scope TEXT;
ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS quota_value NUMERIC(14, 3);
ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS quota_metric TEXT;
ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS quota_id TEXT;
ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS retry_after_ms INTEGER;
ALTER TABLE studio_render_jobs ADD COLUMN IF NOT EXISTS provider_model TEXT;

CREATE TABLE IF NOT EXISTS studio_tts_audio_cache (
  cache_key CHAR(64) PRIMARY KEY CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  model TEXT NOT NULL CHECK (model IN ('gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts')),
  voice TEXT NOT NULL CHECK (voice IN ('Kore', 'Aoede', 'Charon', 'Fenrir', 'Orus')),
  audio_wav BYTEA NOT NULL CHECK (octet_length(audio_wav) BETWEEN 44 AND 20971520),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_tts_audio_cache_expiry_idx ON studio_tts_audio_cache (expires_at);

CREATE TABLE IF NOT EXISTS studio_tts_usage (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('api_call', 'cache_hit')),
  model TEXT NOT NULL CHECK (model IN ('gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts')),
  purpose TEXT NOT NULL CHECK (purpose IN ('render', 'connection_test')),
  outcome TEXT CHECK (outcome IN ('success', 'failure')),
  http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  quota_scope TEXT CHECK (quota_scope IS NULL OR quota_scope IN ('rpm', 'tpm', 'rpd', 'tpd', 'unknown')),
  quota_value NUMERIC(14, 3) CHECK (quota_value IS NULL OR quota_value >= 0),
  quota_metric TEXT CHECK (quota_metric IS NULL OR length(quota_metric) <= 120),
  quota_id TEXT CHECK (quota_id IS NULL OR length(quota_id) <= 120),
  retry_after_ms INTEGER CHECK (retry_after_ms IS NULL OR retry_after_ms BETWEEN 0 AND 604800000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((event_type = 'api_call' AND outcome IS NOT NULL) OR (event_type = 'cache_hit' AND outcome IS NULL))
);
CREATE INDEX IF NOT EXISTS studio_tts_usage_created_at_idx ON studio_tts_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS studio_tts_usage_model_idx ON studio_tts_usage (model, created_at DESC);
