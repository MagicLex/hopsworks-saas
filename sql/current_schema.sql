-- Current Production Schema
-- Date: 2025-12-03
-- This represents the complete current state after all migrations

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Users table with team support
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  login_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),

  -- Account ownership
  account_owner_id TEXT REFERENCES users(id),

  -- Billing
  billing_mode TEXT DEFAULT 'postpaid' CHECK (billing_mode IN ('prepaid', 'postpaid', 'free')),
  stripe_customer_id TEXT,
  stripe_test_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_subscription_status TEXT,
  downgrade_deadline TIMESTAMPTZ, -- Deadline to comply with free tier (delete projects)
  enforcement_state TEXT NOT NULL DEFAULT 'normal' CHECK (enforcement_state IN ('normal', 'throttled', 'frozen')), -- budget axis

  -- Features
  is_admin BOOLEAN DEFAULT false,
  feature_flags JSONB DEFAULT '{}'::jsonb,

  -- Hopsworks
  hopsworks_username TEXT,
  hopsworks_user_id INTEGER,

  -- Promo
  promo_code TEXT,

  -- Soft delete
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  deletion_reason TEXT DEFAULT NULL,

  -- Legal consent
  terms_accepted_at TIMESTAMPTZ DEFAULT NULL,
  marketing_consent BOOLEAN DEFAULT false,

  -- Metadata
  registration_source TEXT,
  registration_ip INET,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Team invites
CREATE TABLE IF NOT EXISTS team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id TEXT REFERENCES users(id) NOT NULL,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  project_role TEXT DEFAULT 'Data scientist',
  auto_assign_projects BOOLEAN DEFAULT true
);

-- Health check failures (monitoring)
CREATE TABLE IF NOT EXISTS health_check_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  check_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT
);

-- Project member roles (team member project assignments)
CREATE TABLE IF NOT EXISTS project_member_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id TEXT NOT NULL,
  account_owner_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  project_namespace TEXT,
  role TEXT NOT NULL,
  synced_to_hopsworks BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  sync_error TEXT,
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- BILLING TABLES
-- =====================================================

-- User projects mapping (OpenCost namespace to user)
-- Note: namespace uniqueness is enforced via partial index (active only)
CREATE TABLE IF NOT EXISTS user_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  namespace TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  capacity_tier TEXT NOT NULL DEFAULT 'small' CHECK (capacity_tier IN ('small', 'medium', 'large', 'exempt')), -- per-project ceiling
  applied_quota_tier TEXT CHECK (applied_quota_tier IN ('small', 'medium', 'large', 'exempt', 'throttled', 'frozen')), -- resolved tier the bookkeeper applies
  quota_updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, project_id)
);

-- User credits for prepaid billing
CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) UNIQUE,
  total_purchased DECIMAL(10,2) DEFAULT 0,
  total_used DECIMAL(10,2) DEFAULT 0,
  free_credits_granted DECIMAL(10,2) DEFAULT 0,
  free_credits_used DECIMAL(10,2) DEFAULT 0,
  cpu_hours_used DECIMAL(10,2) DEFAULT 0,
  gpu_hours_used DECIMAL(10,2) DEFAULT 0,
  storage_gb_months DECIMAL(10,2) DEFAULT 0,
  last_purchase_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily usage tracking (OpenCost integration)
CREATE TABLE IF NOT EXISTS usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id),
  account_owner_id TEXT REFERENCES users(id),
  date DATE NOT NULL,
  
  -- OpenCost metrics
  opencost_cpu_cost DECIMAL(10,4) DEFAULT 0,
  opencost_ram_cost DECIMAL(10,4) DEFAULT 0,
  opencost_storage_cost DECIMAL(10,4) DEFAULT 0,
  opencost_total_cost DECIMAL(10,4) DEFAULT 0,
  opencost_cpu_hours DECIMAL(10,4) DEFAULT 0,
  opencost_ram_gb_hours DECIMAL(10,4) DEFAULT 0,
  opencost_gpu_cost DECIMAL(10,4) DEFAULT 0,
  opencost_gpu_hours DECIMAL(10,4) DEFAULT 0,
  
  -- Storage breakdown
  online_storage_gb DECIMAL(10,4) DEFAULT 0,
  offline_storage_gb DECIMAL(10,4) DEFAULT 0,
  online_storage_cost DECIMAL(10,4) DEFAULT 0,
  offline_storage_cost DECIMAL(10,4) DEFAULT 0,
  
  -- Network
  network_egress_gb DECIMAL(10,4) DEFAULT 0,
  network_egress_cost DECIMAL(10,4) DEFAULT 0,
  
  -- Metadata
  project_breakdown JSONB,
  instance_types JSONB DEFAULT '{}'::jsonb,
  resource_efficiency JSONB DEFAULT '{}'::jsonb,

  -- Stripe sync tracking
  reported_to_stripe BOOLEAN DEFAULT false,
  stripe_usage_record_id TEXT,

  total_credits DECIMAL(10,4) DEFAULT 0,
  total_cost DECIMAL(10,2) DEFAULT 0,
  hopsworks_cluster_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- =====================================================
-- CLUSTER MANAGEMENT
-- =====================================================

-- Hopsworks clusters
CREATE TABLE IF NOT EXISTS hopsworks_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  max_users INTEGER DEFAULT 100,
  current_users INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  region TEXT,
  kubeconfig TEXT,
  mysql_password TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User cluster assignments
CREATE TABLE IF NOT EXISTS user_hopsworks_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) UNIQUE,
  hopsworks_cluster_id UUID REFERENCES hopsworks_clusters(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by TEXT,
  hopsworks_username TEXT
);

-- =====================================================
-- DEPRECATED (TO BE REMOVED)
-- =====================================================

-- Stripe products (prices now in app config)
CREATE TABLE IF NOT EXISTS stripe_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  unit_price DECIMAL(10,4),
  unit_name TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Metering watermark: last collection hour per cluster, to detect missed runs
CREATE TABLE IF NOT EXISTS metering_watermark (
  cluster_id UUID PRIMARY KEY REFERENCES hopsworks_clusters(id) ON DELETE CASCADE,
  last_processed_hour TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_account_owner ON users(account_owner_id) WHERE account_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_invites_owner ON team_invites(account_owner_id);

-- Partial unique: namespace must be unique among ACTIVE projects only
CREATE UNIQUE INDEX IF NOT EXISTS user_projects_namespace_active_unique ON user_projects(namespace) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_user_projects_user_id ON user_projects(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_user_projects_last_seen ON user_projects(last_seen_at);

CREATE INDEX IF NOT EXISTS idx_usage_daily_user_date ON usage_daily(user_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_daily_account_owner ON usage_daily(account_owner_id, date) WHERE account_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_daily_cluster ON usage_daily(hopsworks_cluster_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_daily_gpu ON usage_daily(opencost_gpu_hours) WHERE opencost_gpu_hours > 0;
CREATE INDEX IF NOT EXISTS idx_usage_daily_storage ON usage_daily(online_storage_gb, offline_storage_gb);

-- =====================================================
-- VIEWS
-- =====================================================

CREATE OR REPLACE VIEW team_members AS
SELECT 
  tm.id as member_id,
  tm.email as member_email,
  tm.name as member_name,
  tm.created_at as joined_at,
  tm.hopsworks_username,
  tm.last_login_at,
  owner.id as owner_id,
  owner.email as owner_email,
  owner.name as owner_name
FROM users tm
JOIN users owner ON tm.account_owner_id = owner.id
WHERE tm.account_owner_id IS NOT NULL;

CREATE OR REPLACE VIEW account_usage AS
SELECT 
  COALESCE(u.account_owner_id, u.id) as account_owner_id,
  ud.date,
  SUM(ud.opencost_cpu_hours) as total_cpu_hours,
  SUM(ud.opencost_gpu_hours) as total_gpu_hours,
  SUM(ud.opencost_ram_gb_hours) as total_ram_gb_hours,
  SUM(ud.online_storage_gb) as total_online_storage_gb,
  SUM(ud.offline_storage_gb) as total_offline_storage_gb,
  SUM(ud.opencost_total_cost) as total_cost,
  SUM(ud.opencost_cpu_cost) as cpu_cost,
  SUM(ud.opencost_gpu_cost) as gpu_cost,
  SUM(ud.opencost_ram_cost) as ram_cost,
  SUM(ud.online_storage_cost + ud.offline_storage_cost) as storage_cost
FROM usage_daily ud
JOIN users u ON ud.user_id = u.id
GROUP BY COALESCE(u.account_owner_id, u.id), ud.date;

CREATE OR REPLACE VIEW account_usage_summary AS
SELECT 
  COALESCE(u.account_owner_id, u.id) as account_owner_id,
  ud.date,
  SUM(ud.opencost_cpu_hours) as total_cpu_hours,
  SUM(ud.opencost_gpu_hours) as total_gpu_hours,
  SUM(ud.online_storage_gb + ud.offline_storage_gb) as total_storage_gb,
  SUM(ud.opencost_total_cost) as total_cost,
  COUNT(DISTINCT ud.user_id) as active_users,
  jsonb_object_agg(
    ud.user_id, 
    jsonb_build_object(
      'cpu_hours', ud.opencost_cpu_hours,
      'gpu_hours', ud.opencost_gpu_hours,
      'storage_gb', ud.online_storage_gb + ud.offline_storage_gb,
      'cpu_cost', ud.opencost_cpu_cost,
      'gpu_cost', ud.opencost_gpu_cost,
      'storage_cost', ud.online_storage_cost + ud.offline_storage_cost
    )
  ) as user_breakdown
FROM usage_daily ud
JOIN users u ON ud.user_id = u.id
GROUP BY COALESCE(u.account_owner_id, u.id), ud.date;

-- =====================================================
-- FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION increment_cluster_users(cluster_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE hopsworks_clusters
  SET current_users = current_users + 1,
      updated_at = NOW()
  WHERE id = cluster_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_cluster_users(cluster_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE hopsworks_clusters
  SET current_users = GREATEST(current_users - 1, 0),
      updated_at = NOW()
  WHERE id = cluster_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_user_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE TRIGGER update_users_updated_at 
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_credits_updated_at 
BEFORE UPDATE ON user_credits
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_projects_updated_at
BEFORE UPDATE ON user_projects
FOR EACH ROW EXECUTE FUNCTION update_user_projects_updated_at();

-- =====================================================
-- RLS POLICIES (Currently disabled)
-- =====================================================

-- Uncomment to enable RLS in production
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;
-- etc...