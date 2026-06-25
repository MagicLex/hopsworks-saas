-- Billing enforcement state (control-plane resolution)
-- Date: 2026-06-25
-- Purpose: Persist the two enforcement axes and the single resolved field the
--          quotas-bookkeeper will read, per docs/BILLING_CONTROL_PLANE.md.
--
-- Model:
--   - capacity_tier      (per project): the compute ceiling a project may request.
--   - enforcement_state  (per account): budget axis, derived from month-to-date cost.
--   - applied_quota_tier (per project): resolved value the bookkeeper applies.
--         applied = frozen     if enforcement_state = frozen
--                 = throttled  if enforcement_state = throttled
--                 = capacity_tier otherwise
--
-- These columns are inert until the bookkeeper is switched to read
-- applied_quota_tier (owned by hopsworks-as-a-service). Until then the bridge
-- populates them and nothing downstream consumes them.

-- Account-level budget axis. Free accounts get a default budget (config), paying
-- accounts stay 'normal' unless a self-set spending_cap bites.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS enforcement_state TEXT NOT NULL DEFAULT 'normal'
    CHECK (enforcement_state IN ('normal', 'throttled', 'frozen'));

-- Per-project ceiling and resolved tier.
ALTER TABLE user_projects
  ADD COLUMN IF NOT EXISTS capacity_tier TEXT NOT NULL DEFAULT 'small'
    CHECK (capacity_tier IN ('small', 'medium', 'large', 'exempt'));

ALTER TABLE user_projects
  ADD COLUMN IF NOT EXISTS applied_quota_tier TEXT
    CHECK (applied_quota_tier IN ('small', 'medium', 'large', 'exempt', 'throttled', 'frozen'));

ALTER TABLE user_projects
  ADD COLUMN IF NOT EXISTS quota_updated_at TIMESTAMPTZ;

-- Backfill: paying accounts are exempt (unlimited) today, free accounts default to
-- 'small'. Without this, switching the bookkeeper would slap a small quota onto
-- paying customers. Keyed on the project owner's billing_mode.
UPDATE user_projects up
SET capacity_tier = 'exempt'
FROM users u
WHERE up.user_id = u.id
  AND u.billing_mode IN ('postpaid', 'prepaid');

-- Bootstrap applied_quota_tier = capacity_tier (enforcement_state defaults to
-- 'normal'), so the field is never NULL when the bookkeeper starts reading it.
UPDATE user_projects
SET applied_quota_tier = capacity_tier
WHERE applied_quota_tier IS NULL;

-- The reconciler only writes active projects; index the lookup it does per account.
CREATE INDEX IF NOT EXISTS idx_user_projects_owner_active
  ON user_projects(user_id) WHERE status = 'active';
