-- Baseline schema dump from production Supabase DB.
-- Dumped: 2026-05-10 via pg_dump --schema-only --no-owner --no-acl.
-- This is point-in-time, not idempotent. Future schema changes go in
-- numbered migration files (0001_*.sql, 0002_*.sql, ...).
--

--
-- PostgreSQL database dump
--

\restrict rYEoh8LCwwWEB5gwAlMERaYFLd07XU8OVsj9QbIr6zf7BdzmvEDwwi8aQrU4l6v

-- Dumped from database version 17.4
-- Dumped by pg_dump version 18.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: decrement_cluster_users(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_cluster_users(cluster_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE hopsworks_clusters 
  SET current_users = GREATEST(current_users - 1, 0),
      updated_at = NOW()
  WHERE id = cluster_id;
END;
$$;


--
-- Name: deduct_user_credits(text, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deduct_user_credits(p_user_id text, p_amount numeric, p_description text, p_usage_daily_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_current_balance DECIMAL(10,2);
  v_new_balance DECIMAL(10,2);
  v_free_balance DECIMAL(10,2);
  v_free_deduction DECIMAL(10,2) := 0;
  v_paid_deduction DECIMAL(10,2) := 0;
BEGIN
  -- Get current balance with lock
  SELECT 
    total_purchased - total_used,
    free_credits_granted - free_credits_used
  INTO v_current_balance, v_free_balance
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Check if user has enough credits
  IF v_current_balance < p_amount AND v_free_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  -- Deduct from free credits first
  IF v_free_balance > 0 THEN
    v_free_deduction := LEAST(p_amount, v_free_balance);
    v_paid_deduction := p_amount - v_free_deduction;
  ELSE
    v_paid_deduction := p_amount;
  END IF;

  -- Update credits
  UPDATE user_credits
  SET 
    total_used = total_used + v_paid_deduction,
    free_credits_used = free_credits_used + v_free_deduction,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Record transaction
  v_new_balance := v_current_balance - v_paid_deduction;
  
  INSERT INTO credit_transactions (
    user_id, type, amount, balance_before, balance_after, 
    description, usage_daily_id
  ) VALUES (
    p_user_id, 'usage', -p_amount, v_current_balance, v_new_balance,
    p_description, p_usage_daily_id
  );

  RETURN TRUE;
END;
$$;


--
-- Name: get_member_projects(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_member_projects(p_member_id text) RETURNS TABLE(project_id integer, project_name text, role text, synced boolean, owner_email text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pmr.project_id,
    pmr.project_name,
    pmr.role,
    pmr.synced_to_hopsworks,
    o.email
  FROM project_member_roles pmr
  JOIN users o ON pmr.account_owner_id = o.id
  WHERE pmr.member_id = p_member_id
  ORDER BY pmr.project_name;
END;
$$;


--
-- Name: grant_trial_credits(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grant_trial_credits(p_user_id text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Check if user already has credits record
  INSERT INTO user_credits (user_id, free_credits_granted)
  VALUES (p_user_id, 10.00)
  ON CONFLICT (user_id) DO UPDATE
  SET free_credits_granted = user_credits.free_credits_granted + 10.00;

  -- Record the grant
  INSERT INTO credit_transactions (
    user_id, type, amount, balance_before, balance_after, description
  ) VALUES (
    p_user_id, 'grant', 10.00, 0, 10.00, 'Free trial credits'
  );
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.user_profiles (id)
  VALUES (new.id);
  RETURN new;
END;
$$;


--
-- Name: increment_cluster_users(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_cluster_users(p_cluster_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
  BEGIN
    UPDATE hopsworks_clusters
    SET current_users = current_users + 1
    WHERE id = p_cluster_id;
  END;
  $$;


--
-- Name: recalculate_cluster_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_cluster_users() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE hopsworks_clusters c
  SET current_users = (
    SELECT COUNT(DISTINCT user_id) 
    FROM user_hopsworks_assignments 
    WHERE hopsworks_cluster_id = c.id
  ),
  updated_at = NOW();
END;
$$;


--
-- Name: sum_usage_this_month(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sum_usage_this_month(month_start date) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(SUM(total_cost), 0)
  FROM usage_daily
  WHERE date >= month_start;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_user_projects_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_projects_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: upsert_project_member_role(text, text, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_project_member_role(p_member_id text, p_owner_id text, p_project_id integer, p_project_name text, p_role text, p_added_by text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_role_id UUID;
BEGIN
  INSERT INTO project_member_roles (
    member_id, 
    account_owner_id, 
    project_id, 
    project_name, 
    role,
    added_by,
    synced_to_hopsworks
  ) VALUES (
    p_member_id,
    p_owner_id,
    p_project_id,
    p_project_name,
    p_role,
    p_added_by,
    false
  )
  ON CONFLICT (member_id, project_id) 
  DO UPDATE SET
    role = EXCLUDED.role,
    synced_to_hopsworks = false,
    sync_error = NULL,
    updated_at = NOW()
  RETURNING id INTO v_role_id;
  
  RETURN v_role_id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: usage_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text,
    date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    hopsworks_cluster_id uuid,
    total_cost numeric(10,4) DEFAULT 0,
    account_owner_id text,
    opencost_cpu_cost numeric(10,4) DEFAULT 0,
    opencost_ram_cost numeric(10,4) DEFAULT 0,
    opencost_storage_cost numeric(10,4) DEFAULT 0,
    opencost_cpu_hours numeric(10,4) DEFAULT 0,
    opencost_ram_gb_hours numeric(10,4) DEFAULT 0,
    project_breakdown jsonb,
    opencost_gpu_cost numeric(10,4) DEFAULT 0,
    opencost_gpu_hours numeric(10,4) DEFAULT 0,
    online_storage_gb numeric(10,4) DEFAULT 0,
    offline_storage_gb numeric(10,4) DEFAULT 0,
    online_storage_cost numeric(10,4) DEFAULT 0,
    offline_storage_cost numeric(10,4) DEFAULT 0,
    network_egress_gb numeric(10,4) DEFAULT 0,
    network_egress_cost numeric(10,4) DEFAULT 0,
    instance_types jsonb DEFAULT '{}'::jsonb,
    resource_efficiency jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    reported_to_stripe boolean DEFAULT false,
    total_credits numeric(10,4) DEFAULT 0,
    stripe_usage_record_id text
);


--
-- Name: COLUMN usage_daily.total_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.total_cost IS 'Total cost calculated from usage (USD) - source of truth for billing';


--
-- Name: COLUMN usage_daily.opencost_cpu_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.opencost_cpu_cost IS 'CPU cost from OpenCost (USD)';


--
-- Name: COLUMN usage_daily.opencost_ram_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.opencost_ram_cost IS 'RAM cost from OpenCost (USD)';


--
-- Name: COLUMN usage_daily.opencost_storage_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.opencost_storage_cost IS 'PV storage cost from OpenCost (USD)';


--
-- Name: COLUMN usage_daily.opencost_cpu_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.opencost_cpu_hours IS 'CPU core-hours consumed';


--
-- Name: COLUMN usage_daily.opencost_ram_gb_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.opencost_ram_gb_hours IS 'RAM GB-hours consumed';


--
-- Name: COLUMN usage_daily.project_breakdown; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.project_breakdown IS 'Per-project cost breakdown from OpenCost (JSONB)';


--
-- Name: COLUMN usage_daily.opencost_gpu_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.opencost_gpu_cost IS 'GPU cost from OpenCost (USD)';


--
-- Name: COLUMN usage_daily.opencost_gpu_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.opencost_gpu_hours IS 'GPU hours consumed';


--
-- Name: COLUMN usage_daily.online_storage_gb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.online_storage_gb IS 'Online DB storage in GB (MySQL, etc)';


--
-- Name: COLUMN usage_daily.offline_storage_gb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.offline_storage_gb IS 'Offline storage in GB (HDFS, object storage)';


--
-- Name: COLUMN usage_daily.online_storage_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.online_storage_cost IS 'Cost for online storage';


--
-- Name: COLUMN usage_daily.offline_storage_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.offline_storage_cost IS 'Cost for offline storage';


--
-- Name: COLUMN usage_daily.network_egress_gb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.network_egress_gb IS 'Network egress in GB';


--
-- Name: COLUMN usage_daily.network_egress_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.network_egress_cost IS 'Network egress cost';


--
-- Name: COLUMN usage_daily.instance_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.instance_types IS 'JSON breakdown of instance types used';


--
-- Name: COLUMN usage_daily.resource_efficiency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.resource_efficiency IS 'JSON metrics for CPU/RAM/GPU efficiency';


--
-- Name: COLUMN usage_daily.stripe_usage_record_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_daily.stripe_usage_record_id IS 'Stripe meter event identifier from billing.meterEvents.create() - used for audit and reconciliation';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    registration_source text,
    registration_ip inet,
    last_login_at timestamp with time zone,
    login_count integer DEFAULT 0,
    status text DEFAULT 'active'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_admin boolean DEFAULT false,
    billing_mode text DEFAULT 'postpaid'::text,
    feature_flags jsonb DEFAULT '{}'::jsonb,
    hopsworks_username text,
    stripe_customer_id text,
    account_owner_id text,
    stripe_test_customer_id text,
    hopsworks_user_id integer,
    stripe_subscription_id text,
    stripe_subscription_status text,
    deleted_at timestamp with time zone,
    deletion_reason text,
    promo_code text,
    terms_accepted_at timestamp with time zone,
    marketing_consent boolean DEFAULT false,
    spending_cap numeric(10,2) DEFAULT NULL::numeric,
    spending_alerts_sent jsonb,
    downgrade_deadline timestamp with time zone,
    CONSTRAINT users_billing_mode_check CHECK ((billing_mode = ANY (ARRAY['prepaid'::text, 'postpaid'::text, 'free'::text]))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'deleted'::text])))
);


--
-- Name: COLUMN users.stripe_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.stripe_customer_id IS 'Stripe customer ID for live/production mode';


--
-- Name: COLUMN users.account_owner_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.account_owner_id IS 'NULL = account owner, otherwise references the paying user';


--
-- Name: COLUMN users.stripe_test_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.stripe_test_customer_id IS 'Stripe customer ID for test/sandbox mode';


--
-- Name: COLUMN users.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.deleted_at IS 'Timestamp when user self-deleted their account (soft delete)';


--
-- Name: COLUMN users.deletion_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.deletion_reason IS 'Reason for account deletion (user_requested, team_member_removed, admin_action)';


--
-- Name: COLUMN users.promo_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.promo_code IS 'Promotional code used during signup';


--
-- Name: account_usage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.account_usage WITH (security_barrier='true') AS
 SELECT COALESCE(u.account_owner_id, u.id) AS account_owner_id,
    ud.date,
    sum(ud.opencost_cpu_hours) AS total_cpu_hours,
    sum(ud.opencost_gpu_hours) AS total_gpu_hours,
    sum(ud.opencost_ram_gb_hours) AS total_ram_gb_hours,
    sum(ud.online_storage_gb) AS total_online_storage_gb,
    sum(ud.offline_storage_gb) AS total_offline_storage_gb,
    sum(ud.total_cost) AS total_cost,
    sum(ud.opencost_cpu_cost) AS cpu_cost,
    sum(ud.opencost_gpu_cost) AS gpu_cost,
    sum(ud.opencost_ram_cost) AS ram_cost,
    sum((ud.online_storage_cost + ud.offline_storage_cost)) AS storage_cost
   FROM (public.usage_daily ud
     JOIN public.users u ON ((ud.user_id = u.id)))
  GROUP BY COALESCE(u.account_owner_id, u.id), ud.date;


--
-- Name: account_usage_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.account_usage_summary AS
 SELECT COALESCE(u.account_owner_id, u.id) AS account_owner_id,
    u.email AS owner_email,
    count(DISTINCT
        CASE
            WHEN (u.account_owner_id IS NOT NULL) THEN u.id
            ELSE NULL::text
        END) AS team_member_count,
    sum(ud.opencost_cpu_hours) AS total_cpu_hours,
    sum(ud.opencost_gpu_hours) AS total_gpu_hours,
    sum(ud.opencost_ram_gb_hours) AS total_ram_gb_hours,
    sum(ud.online_storage_gb) AS total_online_storage_gb,
    sum(ud.offline_storage_gb) AS total_offline_storage_gb,
    sum(ud.total_cost) AS total_cost,
    max(ud.date) AS last_usage_date
   FROM (public.usage_daily ud
     JOIN public.users u ON ((ud.user_id = u.id)))
  GROUP BY COALESCE(u.account_owner_id, u.id), u.email;


--
-- Name: health_check_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_check_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    email text NOT NULL,
    check_type text NOT NULL,
    error_message text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    resolution_notes text
);


--
-- Name: hopsworks_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hopsworks_clusters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    api_url text NOT NULL,
    api_key text,
    max_users integer DEFAULT 100,
    current_users integer DEFAULT 0,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    kubeconfig text,
    mysql_password text,
    region text,
    CONSTRAINT hopsworks_clusters_status_check CHECK ((status = ANY (ARRAY['active'::text, 'maintenance'::text, 'full'::text, 'inactive'::text])))
);


--
-- Name: COLUMN hopsworks_clusters.mysql_password; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hopsworks_clusters.mysql_password IS 'MySQL root password for querying NDB storage metrics';


--
-- Name: project_member_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_member_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id text NOT NULL,
    account_owner_id text NOT NULL,
    project_id integer NOT NULL,
    project_name text NOT NULL,
    project_namespace text,
    role text NOT NULL,
    synced_to_hopsworks boolean DEFAULT false,
    last_sync_at timestamp with time zone,
    sync_error text,
    added_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT project_member_roles_role_check CHECK ((role = ANY (ARRAY['Data owner'::text, 'Data scientist'::text, 'Observer'::text])))
);


--
-- Name: TABLE project_member_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.project_member_roles IS 'Tracks team member roles in Hopsworks projects, serving as local state management';


--
-- Name: COLUMN project_member_roles.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.project_member_roles.role IS 'Project role: Data owner, Data scientist, or Observer';


--
-- Name: COLUMN project_member_roles.synced_to_hopsworks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.project_member_roles.synced_to_hopsworks IS 'Whether this role assignment has been successfully synced to Hopsworks';


--
-- Name: COLUMN project_member_roles.sync_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.project_member_roles.sync_error IS 'Error message if sync to Hopsworks failed';


--
-- Name: pending_role_syncs; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pending_role_syncs WITH (security_barrier='true') AS
 SELECT pmr.id,
    pmr.member_id,
    pmr.account_owner_id,
    pmr.project_id,
    pmr.project_name,
    pmr.project_namespace,
    pmr.role,
    pmr.synced_to_hopsworks,
    pmr.last_sync_at,
    pmr.sync_error,
    pmr.added_by,
    pmr.created_at,
    pmr.updated_at,
    m.email AS member_email,
    m.hopsworks_username,
    o.email AS owner_email
   FROM ((public.project_member_roles pmr
     JOIN public.users m ON ((pmr.member_id = m.id)))
     JOIN public.users o ON ((pmr.account_owner_id = o.id)))
  WHERE ((pmr.synced_to_hopsworks = false) AND (pmr.sync_error IS NULL) AND (m.hopsworks_username IS NOT NULL))
  ORDER BY pmr.created_at;


--
-- Name: project_members_detail; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_members_detail WITH (security_barrier='true') AS
 SELECT pmr.id,
    pmr.project_id,
    pmr.project_name,
    pmr.project_namespace,
    pmr.role,
    pmr.synced_to_hopsworks,
    pmr.last_sync_at,
    pmr.created_at,
    pmr.updated_at,
    m.id AS member_id,
    m.email AS member_email,
    m.name AS member_name,
    m.hopsworks_username AS member_hopsworks_username,
    o.id AS owner_id,
    o.email AS owner_email,
    o.name AS owner_name,
    o.hopsworks_username AS owner_hopsworks_username,
    ab.email AS added_by_email,
    ab.name AS added_by_name
   FROM (((public.project_member_roles pmr
     JOIN public.users m ON ((pmr.member_id = m.id)))
     JOIN public.users o ON ((pmr.account_owner_id = o.id)))
     LEFT JOIN public.users ab ON ((pmr.added_by = ab.id)));


--
-- Name: stripe_processed_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_processed_events (
    event_id text NOT NULL,
    event_type text NOT NULL,
    processed_at timestamp with time zone DEFAULT now()
);


--
-- Name: stripe_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_type text NOT NULL,
    stripe_product_id text NOT NULL,
    stripe_price_id text NOT NULL,
    unit_price numeric(10,4) NOT NULL,
    unit_name text NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT stripe_products_product_type_check CHECK ((product_type = ANY (ARRAY['compute_credits'::text, 'storage_online_gb'::text, 'storage_offline_gb'::text])))
);


--
-- Name: TABLE stripe_products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stripe_products IS 'DEPRECATED: Product info is hardcoded in app. Will be removed in future cleanup.';


--
-- Name: team_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_owner_id text NOT NULL,
    email text NOT NULL,
    token text DEFAULT (gen_random_uuid())::text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by_user_id text,
    created_at timestamp with time zone DEFAULT now(),
    project_role text DEFAULT 'Data scientist'::text,
    auto_assign_projects boolean DEFAULT true
);


--
-- Name: team_members; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.team_members WITH (security_barrier='true') AS
 SELECT tm.id AS member_id,
    tm.email AS member_email,
    tm.name AS member_name,
    tm.created_at AS joined_at,
    tm.hopsworks_username,
    tm.last_login_at,
    owner.id AS owner_id,
    owner.email AS owner_email,
    owner.name AS owner_name
   FROM (public.users tm
     JOIN public.users owner ON ((tm.account_owner_id = owner.id)))
  WHERE (tm.account_owner_id IS NOT NULL);


--
-- Name: user_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text,
    total_purchased numeric(10,2) DEFAULT 0,
    total_used numeric(10,2) DEFAULT 0,
    cpu_hours_used numeric(10,2) DEFAULT 0,
    gpu_hours_used numeric(10,2) DEFAULT 0,
    storage_gb_months numeric(10,2) DEFAULT 0,
    last_purchase_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    balance numeric(10,2) GENERATED ALWAYS AS ((total_purchased - total_used)) STORED,
    free_credits_granted numeric(10,2) DEFAULT 0,
    free_credits_used numeric(10,2) DEFAULT 0,
    gpu_hours_purchased numeric(10,2) DEFAULT 0,
    online_storage_gb_months numeric(10,2) DEFAULT 0,
    offline_storage_gb_months numeric(10,2) DEFAULT 0
);


--
-- Name: user_hopsworks_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_hopsworks_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text,
    hopsworks_cluster_id uuid,
    assigned_at timestamp with time zone DEFAULT now(),
    hopsworks_username text,
    hopsworks_user_id integer
);


--
-- Name: TABLE user_hopsworks_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_hopsworks_assignments IS 'Maps users to shared Hopsworks cluster endpoints. Users share clusters, not individual instances.';


--
-- Name: user_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text,
    project_id integer NOT NULL,
    project_name text NOT NULL,
    namespace text NOT NULL,
    status text DEFAULT 'active'::text,
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: health_check_failures health_check_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_check_failures
    ADD CONSTRAINT health_check_failures_pkey PRIMARY KEY (id);


--
-- Name: hopsworks_clusters hopsworks_clusters_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hopsworks_clusters
    ADD CONSTRAINT hopsworks_clusters_name_key UNIQUE (name);


--
-- Name: hopsworks_clusters hopsworks_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hopsworks_clusters
    ADD CONSTRAINT hopsworks_clusters_pkey PRIMARY KEY (id);


--
-- Name: project_member_roles project_member_roles_member_id_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_roles
    ADD CONSTRAINT project_member_roles_member_id_project_id_key UNIQUE (member_id, project_id);


--
-- Name: project_member_roles project_member_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_roles
    ADD CONSTRAINT project_member_roles_pkey PRIMARY KEY (id);


--
-- Name: stripe_processed_events stripe_processed_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_processed_events
    ADD CONSTRAINT stripe_processed_events_pkey PRIMARY KEY (event_id);


--
-- Name: stripe_products stripe_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_products
    ADD CONSTRAINT stripe_products_pkey PRIMARY KEY (id);


--
-- Name: stripe_products stripe_products_product_type_active_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_products
    ADD CONSTRAINT stripe_products_product_type_active_key UNIQUE (product_type, active);


--
-- Name: team_invites team_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_pkey PRIMARY KEY (id);


--
-- Name: team_invites team_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_token_key UNIQUE (token);


--
-- Name: usage_daily usage_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_daily
    ADD CONSTRAINT usage_daily_pkey PRIMARY KEY (id);


--
-- Name: usage_daily usage_daily_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_daily
    ADD CONSTRAINT usage_daily_user_id_date_key UNIQUE (user_id, date);


--
-- Name: user_credits user_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_pkey PRIMARY KEY (id);


--
-- Name: user_credits user_credits_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_user_id_key UNIQUE (user_id);


--
-- Name: user_hopsworks_assignments user_hopsworks_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_hopsworks_assignments
    ADD CONSTRAINT user_hopsworks_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_hopsworks_assignments user_hopsworks_assignments_user_id_hopsworks_cluster_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_hopsworks_assignments
    ADD CONSTRAINT user_hopsworks_assignments_user_id_hopsworks_cluster_id_key UNIQUE (user_id, hopsworks_cluster_id);


--
-- Name: user_projects user_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_projects
    ADD CONSTRAINT user_projects_pkey PRIMARY KEY (id);


--
-- Name: user_projects user_projects_user_id_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_projects
    ADD CONSTRAINT user_projects_user_id_project_id_key UNIQUE (user_id, project_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_health_check_failures_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_health_check_failures_created_at ON public.health_check_failures USING btree (created_at DESC);


--
-- Name: idx_health_check_failures_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_health_check_failures_email ON public.health_check_failures USING btree (email);


--
-- Name: idx_health_check_failures_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_health_check_failures_unresolved ON public.health_check_failures USING btree (resolved_at) WHERE (resolved_at IS NULL);


--
-- Name: idx_health_check_failures_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_health_check_failures_user_id ON public.health_check_failures USING btree (user_id);


--
-- Name: idx_hopsworks_clusters_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hopsworks_clusters_status ON public.hopsworks_clusters USING btree (status);


--
-- Name: idx_project_member_roles_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_member_roles_member ON public.project_member_roles USING btree (member_id);


--
-- Name: idx_project_member_roles_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_member_roles_owner ON public.project_member_roles USING btree (account_owner_id);


--
-- Name: idx_project_member_roles_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_member_roles_project ON public.project_member_roles USING btree (project_id, project_name);


--
-- Name: idx_project_member_roles_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_member_roles_sync_status ON public.project_member_roles USING btree (synced_to_hopsworks, last_sync_at) WHERE (synced_to_hopsworks = false);


--
-- Name: idx_stripe_processed_events_processed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stripe_processed_events_processed_at ON public.stripe_processed_events USING btree (processed_at);


--
-- Name: idx_team_invites_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invites_email ON public.team_invites USING btree (email) WHERE (accepted_at IS NULL);


--
-- Name: idx_team_invites_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invites_owner ON public.team_invites USING btree (account_owner_id);


--
-- Name: idx_team_invites_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invites_token ON public.team_invites USING btree (token) WHERE (accepted_at IS NULL);


--
-- Name: idx_usage_daily_account_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_daily_account_owner ON public.usage_daily USING btree (account_owner_id, date) WHERE (account_owner_id IS NOT NULL);


--
-- Name: idx_usage_daily_cluster; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_daily_cluster ON public.usage_daily USING btree (hopsworks_cluster_id, date DESC);


--
-- Name: idx_usage_daily_gpu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_daily_gpu ON public.usage_daily USING btree (opencost_gpu_hours) WHERE (opencost_gpu_hours > (0)::numeric);


--
-- Name: idx_usage_daily_storage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_daily_storage ON public.usage_daily USING btree (online_storage_gb, offline_storage_gb);


--
-- Name: idx_usage_daily_stripe_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_daily_stripe_record ON public.usage_daily USING btree (stripe_usage_record_id) WHERE (stripe_usage_record_id IS NOT NULL);


--
-- Name: idx_usage_daily_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_daily_user_date ON public.usage_daily USING btree (user_id, date);


--
-- Name: idx_user_credits_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_credits_user_id ON public.user_credits USING btree (user_id);


--
-- Name: idx_user_hopsworks_assignments_cluster; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_hopsworks_assignments_cluster ON public.user_hopsworks_assignments USING btree (hopsworks_cluster_id);


--
-- Name: idx_user_hopsworks_assignments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_hopsworks_assignments_user ON public.user_hopsworks_assignments USING btree (user_id);


--
-- Name: idx_user_projects_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_projects_last_seen ON public.user_projects USING btree (last_seen_at);


--
-- Name: idx_user_projects_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_projects_user_id ON public.user_projects USING btree (user_id) WHERE (status = 'active'::text);


--
-- Name: idx_users_account_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_account_owner ON public.users USING btree (account_owner_id) WHERE (account_owner_id IS NOT NULL);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_created_at ON public.users USING btree (created_at);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_stripe_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_stripe_customer_id ON public.users USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: idx_users_terms_not_accepted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_terms_not_accepted ON public.users USING btree (id) WHERE ((terms_accepted_at IS NULL) AND (deleted_at IS NULL));


--
-- Name: idx_users_with_spending_cap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_with_spending_cap ON public.users USING btree (id) WHERE ((spending_cap IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: user_projects_namespace_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_projects_namespace_active_unique ON public.user_projects USING btree (namespace) WHERE (status = 'active'::text);


--
-- Name: project_member_roles update_project_member_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_project_member_roles_updated_at BEFORE UPDATE ON public.project_member_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: stripe_products update_stripe_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_stripe_products_updated_at BEFORE UPDATE ON public.stripe_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_credits update_user_credits_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_credits_updated_at BEFORE UPDATE ON public.user_credits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_projects update_user_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_projects_updated_at BEFORE UPDATE ON public.user_projects FOR EACH ROW EXECUTE FUNCTION public.update_user_projects_updated_at();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: project_member_roles project_member_roles_account_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_roles
    ADD CONSTRAINT project_member_roles_account_owner_id_fkey FOREIGN KEY (account_owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: project_member_roles project_member_roles_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_roles
    ADD CONSTRAINT project_member_roles_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: project_member_roles project_member_roles_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_roles
    ADD CONSTRAINT project_member_roles_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: team_invites team_invites_accepted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: team_invites team_invites_account_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_account_owner_id_fkey FOREIGN KEY (account_owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: usage_daily usage_daily_account_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_daily
    ADD CONSTRAINT usage_daily_account_owner_id_fkey FOREIGN KEY (account_owner_id) REFERENCES public.users(id);


--
-- Name: usage_daily usage_daily_hopsworks_cluster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_daily
    ADD CONSTRAINT usage_daily_hopsworks_cluster_id_fkey FOREIGN KEY (hopsworks_cluster_id) REFERENCES public.hopsworks_clusters(id);


--
-- Name: usage_daily usage_daily_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_daily
    ADD CONSTRAINT usage_daily_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_credits user_credits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_hopsworks_assignments user_hopsworks_assignments_hopsworks_cluster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_hopsworks_assignments
    ADD CONSTRAINT user_hopsworks_assignments_hopsworks_cluster_id_fkey FOREIGN KEY (hopsworks_cluster_id) REFERENCES public.hopsworks_clusters(id) ON DELETE CASCADE;


--
-- Name: user_hopsworks_assignments user_hopsworks_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_hopsworks_assignments
    ADD CONSTRAINT user_hopsworks_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_projects user_projects_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_projects
    ADD CONSTRAINT user_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_account_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_account_owner_id_fkey FOREIGN KEY (account_owner_id) REFERENCES public.users(id);


--
-- Name: health_check_failures Admins can update health check failures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update health check failures" ON public.health_check_failures FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = (auth.uid())::text) AND (users.is_admin = true)))));


--
-- Name: health_check_failures Admins can view all health check failures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all health check failures" ON public.health_check_failures FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = (auth.uid())::text) AND (users.is_admin = true)))));


--
-- Name: stripe_products Anyone can view stripe products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view stripe products" ON public.stripe_products FOR SELECT USING (true);


--
-- Name: project_member_roles Members can view own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can view own roles" ON public.project_member_roles FOR SELECT USING ((member_id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: project_member_roles Owners can view team member roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can view team member roles" ON public.project_member_roles FOR SELECT USING ((account_owner_id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: health_check_failures Service role can insert health check failures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert health check failures" ON public.health_check_failures FOR INSERT WITH CHECK (true);


--
-- Name: team_invites Users can view invites sent to them; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view invites sent to them" ON public.team_invites FOR SELECT USING ((email = ((auth.jwt())::json ->> 'email'::text)));


--
-- Name: team_invites Users can view invites they sent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view invites they sent" ON public.team_invites FOR SELECT USING ((account_owner_id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: user_hopsworks_assignments Users can view own assignment; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own assignment" ON public.user_hopsworks_assignments FOR SELECT USING ((user_id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: user_credits Users can view own credits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own credits" ON public.user_credits FOR SELECT USING ((user_id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: users Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING ((id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: user_projects Users can view own projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own projects" ON public.user_projects FOR SELECT USING ((user_id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: usage_daily Users can view own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own usage" ON public.usage_daily FOR SELECT USING ((user_id = ((auth.jwt())::json ->> 'sub'::text)));


--
-- Name: users Users can view team members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view team members" ON public.users FOR SELECT USING (((account_owner_id IS NOT NULL) AND (account_owner_id = ((auth.jwt())::json ->> 'sub'::text))));


--
-- Name: users Users can view their account owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their account owner" ON public.users FOR SELECT USING ((id IN ( SELECT users_1.account_owner_id
   FROM public.users users_1
  WHERE (users_1.id = ((auth.jwt())::json ->> 'sub'::text)))));


--
-- Name: hopsworks_clusters Users can view their assigned cluster; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their assigned cluster" ON public.hopsworks_clusters FOR SELECT USING ((id IN ( SELECT user_hopsworks_assignments.hopsworks_cluster_id
   FROM public.user_hopsworks_assignments
  WHERE (user_hopsworks_assignments.user_id = ((auth.jwt())::json ->> 'sub'::text)))));


--
-- Name: health_check_failures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.health_check_failures ENABLE ROW LEVEL SECURITY;

--
-- Name: hopsworks_clusters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hopsworks_clusters ENABLE ROW LEVEL SECURITY;

--
-- Name: project_member_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_member_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_products ENABLE ROW LEVEL SECURITY;

--
-- Name: team_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: user_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: user_hopsworks_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_hopsworks_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: user_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_projects ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict rYEoh8LCwwWEB5gwAlMERaYFLd07XU8OVsj9QbIr6zf7BdzmvEDwwi8aQrU4l6v

