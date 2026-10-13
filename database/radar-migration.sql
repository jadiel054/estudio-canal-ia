-- Etapa B: histórico do Radar real. Migração somente aditiva; não altera nem apaga tabelas existentes.
CREATE TABLE IF NOT EXISTS radar_signals (
  signal_key TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('Hacker News', 'GitHub', 'dev.to')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  collected_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS radar_signals_collected_idx ON radar_signals (collected_at DESC);
CREATE INDEX IF NOT EXISTS radar_signals_score_idx ON radar_signals (score DESC, collected_at DESC);

CREATE TABLE IF NOT EXISTS radar_observations (
  id BIGSERIAL PRIMARY KEY,
  signal_key TEXT NOT NULL REFERENCES radar_signals(signal_key) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metric BIGINT NOT NULL DEFAULT 0 CHECK (metric >= 0)
);
CREATE INDEX IF NOT EXISTS radar_observations_signal_time_idx ON radar_observations (signal_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS radar_runs (
  id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'cron')),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  classified INTEGER NOT NULL DEFAULT 0 CHECK (classified >= 0)
);
CREATE INDEX IF NOT EXISTS radar_runs_finished_idx ON radar_runs (finished_at DESC);
