-- Tag clusters by environment so staging (dev.run.hopsworks.ai) and production
-- (run.hopsworks.ai) auto-assign users to different clusters despite sharing
-- the same Supabase DB. Without this, a staging signup could land on the prod
-- cluster (and vice versa) since selection only filters by status+capacity.
--
-- Default 'production' on existing rows. The staging cluster row must be
-- inserted (or updated) explicitly with environment='staging'.
-- Run BEFORE deploying the matching code change. Idempotent.

ALTER TABLE hopsworks_clusters
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hopsworks_clusters_environment_check'
  ) THEN
    ALTER TABLE hopsworks_clusters
      ADD CONSTRAINT hopsworks_clusters_environment_check
      CHECK (environment IN ('production', 'staging'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hopsworks_clusters_env_status
  ON hopsworks_clusters (environment, status);
