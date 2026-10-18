-- PR-2A — schema de Analytics YouTube e sinais internos
-- Não executar automaticamente. Esta migration é aditiva e preserva analytics_snapshots legado.
-- Tokens, client secrets e conteúdo bruto de respostas permanecem fora do banco.

CREATE TABLE IF NOT EXISTS analytics_collection_runs (
  id UUID PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual', 'reconcile')),
  scheduled_slot_utc TIMESTAMPTZ NOT NULL,
  source_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'
    CHECK (source_timezone = 'America/Los_Angeles'),
  requested_start_date DATE NOT NULL,
  requested_end_date DATE NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_data_date DATE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'not_ready', 'failed')),
  requested_video_count INTEGER NOT NULL DEFAULT 0 CHECK (requested_video_count >= 0),
  processed_video_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_video_count >= 0),
  returned_row_count INTEGER NOT NULL DEFAULT 0 CHECK (returned_row_count >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (requested_end_date >= requested_start_date),
  CHECK ((status = 'running') = (lease_expires_at IS NOT NULL OR finished_at IS NULL)),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  UNIQUE (channel_id, scheduled_slot_utc)
);

CREATE INDEX IF NOT EXISTS analytics_collection_runs_channel_time_idx
  ON analytics_collection_runs (channel_id, scheduled_slot_utc DESC);
CREATE INDEX IF NOT EXISTS analytics_collection_runs_lease_idx
  ON analytics_collection_runs (channel_id, lease_expires_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS analytics_collection_runs_status_idx
  ON analytics_collection_runs (status, scheduled_slot_utc DESC);

CREATE TABLE IF NOT EXISTS youtube_video_daily_metrics (
  id UUID PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  publication_id BIGINT REFERENCES publications(id) ON DELETE SET NULL,
  youtube_video_id TEXT NOT NULL CHECK (length(youtube_video_id) BETWEEN 1 AND 200),
  metric_date DATE NOT NULL,
  source_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'
    CHECK (source_timezone = 'America/Los_Angeles'),
  views BIGINT CHECK (views IS NULL OR views >= 0),
  average_view_percentage NUMERIC(7, 4)
    CHECK (average_view_percentage IS NULL OR average_view_percentage BETWEEN 0 AND 100),
  average_view_duration_seconds NUMERIC(12, 3)
    CHECK (average_view_duration_seconds IS NULL OR average_view_duration_seconds >= 0),
  impressions BIGINT CHECK (impressions IS NULL OR impressions >= 0),
  thumbnail_ctr NUMERIC(7, 4)
    CHECK (thumbnail_ctr IS NULL OR thumbnail_ctr BETWEEN 0 AND 100),
  subscribers_gained BIGINT CHECK (subscribers_gained IS NULL OR subscribers_gained >= 0),
  subscribers_lost BIGINT CHECK (subscribers_lost IS NULL OR subscribers_lost >= 0),
  analytics_status TEXT NOT NULL DEFAULT 'not_ready'
    CHECK (analytics_status IN ('available', 'partial', 'not_ready', 'unavailable', 'failed')),
  reach_status TEXT NOT NULL DEFAULT 'not_ready'
    CHECK (reach_status IN ('available', 'partial', 'not_ready', 'unavailable', 'failed')),
  effective_end_date DATE,
  fetched_at TIMESTAMPTZ,
  run_id UUID REFERENCES analytics_collection_runs(id) ON DELETE SET NULL,
  schema_version TEXT NOT NULL DEFAULT 'youtube-analytics-v1'
    CHECK (length(schema_version) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_end_date IS NULL OR effective_end_date >= metric_date),
  UNIQUE (channel_id, youtube_video_id, metric_date)
);

CREATE INDEX IF NOT EXISTS youtube_video_daily_metrics_video_date_idx
  ON youtube_video_daily_metrics (youtube_video_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS youtube_video_daily_metrics_channel_date_idx
  ON youtube_video_daily_metrics (channel_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS youtube_video_daily_metrics_ranking_idx
  ON youtube_video_daily_metrics (channel_id, metric_date DESC, views DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS youtube_video_daily_metrics_run_idx
  ON youtube_video_daily_metrics (run_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS analytics_insights (
  id UUID PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  period_start_date DATE NOT NULL,
  period_end_date DATE NOT NULL,
  calculation_version TEXT NOT NULL CHECK (length(calculation_version) BETWEEN 1 AND 80),
  insight_type TEXT NOT NULL CHECK (length(insight_type) BETWEEN 1 AND 80),
  summary_ptbr TEXT NOT NULL CHECK (length(summary_ptbr) BETWEEN 1 AND 4000),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(6, 5) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'accepted', 'rejected', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end_date >= period_start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_insights_natural_key_uidx
  ON analytics_insights (channel_id, period_start_date, period_end_date, calculation_version, insight_type);
CREATE INDEX IF NOT EXISTS analytics_insights_channel_period_idx
  ON analytics_insights (channel_id, period_end_date DESC, period_start_date DESC);
CREATE INDEX IF NOT EXISTS analytics_insights_status_idx
  ON analytics_insights (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS radar_learning_signals (
  id UUID PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  insight_id UUID NOT NULL REFERENCES analytics_insights(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL UNIQUE CHECK (length(signal_key) BETWEEN 1 AND 200),
  state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed', 'accepted', 'rejected', 'retired')),
  signal_type TEXT NOT NULL CHECK (length(signal_type) BETWEEN 1 AND 80),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  audit JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (accepted_at IS NULL OR state = 'accepted')
);

CREATE INDEX IF NOT EXISTS radar_learning_signals_channel_time_idx
  ON radar_learning_signals (channel_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS radar_learning_signals_insight_idx
  ON radar_learning_signals (insight_id);
CREATE INDEX IF NOT EXISTS radar_learning_signals_state_idx
  ON radar_learning_signals (state, updated_at DESC);
