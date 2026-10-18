import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration de Analytics YouTube PR-2A", () => {
  const sql = readFileSync(resolve(process.cwd(), "database/youtube-analytics-migration.sql"), "utf8");

  it("é aditiva e cria as quatro entidades do contrato", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS analytics_collection_runs");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS youtube_video_daily_metrics");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS analytics_insights");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS radar_learning_signals");
    expect(sql).toContain("analytics_snapshots legado");
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|ALTER\s+TABLE\s+.*\s+DROP)\b/im);
  });

  it("preserva o grão canônico e a semântica de métricas nullable", () => {
    expect(sql).toContain("UNIQUE (channel_id, youtube_video_id, metric_date)");
    expect(sql).toContain("average_view_percentage");
    expect(sql).toContain("average_view_duration_seconds");
    expect(sql).toContain("subscribers_gained");
    expect(sql).toContain("subscribers_lost");
    expect(sql).toContain("thumbnail_ctr NUMERIC(7, 4)");
    expect(sql).toContain("source_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'");
  });

  it("define lease, janela, estados e erros sanitizados para runs", () => {
    expect(sql).toContain("scheduled_slot_utc TIMESTAMPTZ NOT NULL");
    expect(sql).toContain("lease_owner TEXT");
    expect(sql).toContain("lease_expires_at TIMESTAMPTZ");
    expect(sql).toContain("CHECK (status IN ('running', 'success', 'partial', 'not_ready', 'failed'))");
    expect(sql).toContain("error_code TEXT");
    expect(sql).toContain("length(error_message) <= 500");
    expect(sql).toContain("analytics_collection_runs_lease_idx");
  });

  it("mantém aprendizado interno separado do Radar público", () => {
    expect(sql).toContain("insight_id UUID NOT NULL REFERENCES analytics_insights");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS radar_learning_signals");
    expect(sql).toContain("signal_key TEXT NOT NULL UNIQUE");
    expect(sql).not.toContain("CREATE TABLE IF NOT EXISTS radar_signals");
  });
});
