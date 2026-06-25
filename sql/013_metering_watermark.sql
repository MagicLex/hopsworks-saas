-- Metering watermark: detect and surface missed collection hours.
-- Date: 2026-06-25
-- collect-opencost queries OpenCost with window=1h each run and has no backfill, so a
-- skipped or failed cron tick silently loses that hour's usage. This watermark records
-- the last hour processed per cluster; the cron compares it to now and alerts on gaps,
-- so lost-revenue hours surface loudly instead of vanishing.

CREATE TABLE IF NOT EXISTS metering_watermark (
  cluster_id UUID PRIMARY KEY REFERENCES hopsworks_clusters(id) ON DELETE CASCADE,
  last_processed_hour TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
