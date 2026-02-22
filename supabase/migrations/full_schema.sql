-- ============================================================================
-- Mydevify — Full Database Schema (from scratch)
-- Generated: February 20, 2026
-- Supabase (PostgreSQL)
-- 
-- This migration recreates the entire database from zero.
-- Use for: documentation, new Supabase projects, disaster recovery.
-- DO NOT run on an existing database — it will fail on conflicts.
-- ============================================================================


-- ============================================================================
-- 1. CUSTOM ENUM TYPES (10 total)
-- ============================================================================

CREATE TYPE plan_tier AS ENUM ('starter', 'pro', 'business', 'enterprise');

CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled',
  'unpaid', 'paused', 'incomplete', 'incomplete_expired'
);

CREATE TYPE billing_interval AS ENUM ('monthly', 'yearly');

CREATE TYPE team_role AS ENUM ('owner', 'member');

CREATE TYPE api_key_policy AS ENUM ('shared', 'individual');

CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'expired', 'canceled');

CREATE TYPE activity_action AS ENUM (
  'project_created', 'project_deleted', 'project_opened',
  'deployed', 'deploy_failed',
  'member_joined', 'member_removed', 'member_invited',
  'team_created', 'team_settings_changed',
  'task_created', 'task_run', 'task_failed'
);

CREATE TYPE command_type AS ENUM ('wake', 'shutdown', 'restart', 'sleep');

CREATE TYPE command_status AS ENUM ('pending', 'sent', 'executed', 'failed', 'expired');


-- ============================================================================
-- 2. TABLES (18 total)
-- ============================================================================


-- --------------------------------------------------------------------------
-- 2.1 profiles — Extends auth.users. One row per user.
-- --------------------------------------------------------------------------
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  plan plan_tier NOT NULL DEFAULT 'starter',
  subscription_status subscription_status NOT NULL DEFAULT 'incomplete',
  stripe_customer_id TEXT UNIQUE,
  app_version TEXT,
  os TEXT,
  country TEXT,
  timezone TEXT,
  locale TEXT DEFAULT 'en',
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  signup_source TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  admin_notes TEXT,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.2 subscriptions — Mirrors Stripe subscription state.
-- --------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT NOT NULL,
  plan plan_tier NOT NULL,
  billing_interval billing_interval NOT NULL,
  status subscription_status NOT NULL DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.3 stripe_webhook_events — Idempotency tracking for Stripe webhooks.
-- --------------------------------------------------------------------------
CREATE TABLE stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB
);


-- --------------------------------------------------------------------------
-- 2.4 teams — Team entity.
-- --------------------------------------------------------------------------
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'My Team',
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan plan_tier NOT NULL,
  api_key_policy api_key_policy NOT NULL DEFAULT 'individual',
  max_seats INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.5 team_members — Join table: user + team + role.
-- --------------------------------------------------------------------------
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role team_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id),
  UNIQUE (user_id)  -- MVP: one team per user (to be dropped for multi-team)
);


-- --------------------------------------------------------------------------
-- 2.6 team_invitations — Invitation records.
-- --------------------------------------------------------------------------
CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status invitation_status NOT NULL DEFAULT 'pending',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.7 project_locks — One person per project at a time.
-- --------------------------------------------------------------------------
CREATE TABLE project_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  locked_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, project_name)
);


-- --------------------------------------------------------------------------
-- 2.8 team_activity_log — Chronological log of team actions.
-- --------------------------------------------------------------------------
CREATE TABLE team_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action activity_action NOT NULL,
  project_name TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.9 usage_events — Per-API-call data synced from desktop.
-- --------------------------------------------------------------------------
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC NOT NULL DEFAULT 0,
  project_name TEXT,
  session_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.10 feature_events — Tracks feature usage.
-- --------------------------------------------------------------------------
CREATE TABLE feature_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.11 app_sessions — Session tracking for DAU/MAU/retention.
-- --------------------------------------------------------------------------
CREATE TABLE app_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  app_version TEXT NOT NULL,
  os TEXT NOT NULL,
  os_version TEXT,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  files_modified INTEGER NOT NULL DEFAULT 0,
  deploys INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.12 devices — Desktop computers registered by users.
-- --------------------------------------------------------------------------
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL DEFAULT 'My Computer',
  mac_address TEXT,
  local_ip TEXT,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  cpu_usage REAL,
  ram_usage REAL,
  disk_usage REAL,
  os TEXT,
  os_version TEXT,
  app_version TEXT,
  wake_method TEXT,
  wol_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  wol_broadcast_ip TEXT,
  wol_public_ip TEXT,
  wol_public_port INTEGER DEFAULT 9,
  bios_power_on_ac BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.13 remote_commands — Commands from mobile to desktop.
-- --------------------------------------------------------------------------
CREATE TABLE remote_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  command command_type NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  status command_status NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.14 pairing_tokens — Securely links mobile to desktop.
-- --------------------------------------------------------------------------
CREATE TABLE pairing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  pairing_code TEXT,
  is_paired BOOLEAN NOT NULL DEFAULT FALSE,
  paired_device_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.15 synced_projects — Project metadata synced from desktop for mobile.
-- --------------------------------------------------------------------------
CREATE TABLE synced_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  project_path TEXT NOT NULL,
  tech_stack TEXT[],
  file_count INTEGER,
  last_ai_session TIMESTAMPTZ,
  deploy_provider TEXT,
  deploy_url TEXT,
  last_deployed TIMESTAMPTZ,
  deploy_status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id, project_name)
);


-- --------------------------------------------------------------------------
-- 2.16 synced_tasks — Scheduled task statuses synced from desktop.
-- --------------------------------------------------------------------------
CREATE TABLE synced_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  task_id_local TEXT NOT NULL,
  project_name TEXT,
  schedule TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_error TEXT,
  next_run_at TIMESTAMPTZ,
  steps_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id, task_id_local)
);


-- --------------------------------------------------------------------------
-- 2.17 admin_audit_log — Tracks what admins do.
-- --------------------------------------------------------------------------
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES profiles(id),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- --------------------------------------------------------------------------
-- 2.18 user_projects — Project registration for plan limit enforcement.
-- --------------------------------------------------------------------------
CREATE TABLE user_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path_hash TEXT NOT NULL,
  project_name TEXT NOT NULL DEFAULT 'Unnamed Project',
  machine_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  first_added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, path_hash)
);


-- ============================================================================
-- 3. INDEXES (beyond PKs and unique constraints)
-- ============================================================================

-- profiles
CREATE INDEX idx_profiles_email ON profiles (email);
CREATE INDEX idx_profiles_plan ON profiles (plan);
CREATE INDEX idx_profiles_subscription_status ON profiles (subscription_status);
CREATE INDEX idx_profiles_stripe_customer ON profiles (stripe_customer_id);
CREATE INDEX idx_profiles_country ON profiles (country);
CREATE INDEX idx_profiles_last_active ON profiles (last_active_at DESC);
CREATE INDEX idx_profiles_created_at ON profiles (created_at DESC);
CREATE INDEX idx_profiles_is_admin ON profiles (is_admin) WHERE is_admin = TRUE;

-- subscriptions
CREATE INDEX idx_subscriptions_user ON subscriptions (user_id);
CREATE INDEX idx_subscriptions_stripe_sub ON subscriptions (stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON subscriptions (status);
CREATE INDEX idx_subscriptions_period_end ON subscriptions (current_period_end);

-- teams
CREATE INDEX idx_teams_owner ON teams (owner_id);

-- team_members
CREATE INDEX idx_team_members_team ON team_members (team_id);
CREATE INDEX idx_team_members_user ON team_members (user_id);

-- team_invitations
CREATE INDEX idx_invitations_team ON team_invitations (team_id);
CREATE INDEX idx_invitations_email ON team_invitations (email);
CREATE INDEX idx_invitations_status ON team_invitations (status);
CREATE INDEX idx_invitations_token ON team_invitations (token);

-- project_locks
CREATE INDEX idx_locks_team ON project_locks (team_id);
CREATE INDEX idx_locks_heartbeat ON project_locks (last_heartbeat);

-- team_activity_log
CREATE INDEX idx_activity_team ON team_activity_log (team_id);
CREATE INDEX idx_activity_user ON team_activity_log (user_id);
CREATE INDEX idx_activity_team_created ON team_activity_log (team_id, created_at DESC);

-- usage_events
CREATE INDEX idx_usage_user ON usage_events (user_id);
CREATE INDEX idx_usage_provider ON usage_events (provider);
CREATE INDEX idx_usage_model ON usage_events (model);
CREATE INDEX idx_usage_occurred ON usage_events (occurred_at DESC);
CREATE INDEX idx_usage_user_occurred ON usage_events (user_id, occurred_at DESC);

-- feature_events
CREATE INDEX idx_features_user ON feature_events (user_id);
CREATE INDEX idx_features_feature ON feature_events (feature);
CREATE INDEX idx_features_occurred ON feature_events (occurred_at DESC);

-- app_sessions
CREATE INDEX idx_sessions_user ON app_sessions (user_id);
CREATE INDEX idx_sessions_started ON app_sessions (started_at DESC);

-- devices
CREATE INDEX idx_devices_user ON devices (user_id);
CREATE INDEX idx_devices_heartbeat ON devices (last_heartbeat);

-- remote_commands
CREATE INDEX idx_commands_device ON remote_commands (device_id);
CREATE INDEX idx_commands_status ON remote_commands (status);

-- stripe_webhook_events
CREATE INDEX idx_webhook_event_id ON stripe_webhook_events (stripe_event_id);
CREATE INDEX idx_webhook_type ON stripe_webhook_events (event_type);

-- synced_projects
CREATE INDEX idx_synced_projects_user ON synced_projects (user_id);

-- synced_tasks
CREATE INDEX idx_synced_tasks_user ON synced_tasks (user_id);

-- admin_audit_log
CREATE INDEX idx_audit_admin ON admin_audit_log (admin_id);
CREATE INDEX idx_audit_target ON admin_audit_log (target_user_id);
CREATE INDEX idx_audit_created ON admin_audit_log (created_at DESC);

-- user_projects
CREATE INDEX idx_user_projects_user ON user_projects (user_id);
CREATE INDEX idx_user_projects_status ON user_projects (user_id, status);


-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- is_admin() — Checks if current user is an admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  );
$$;

-- is_team_member(team_uuid) — Checks if current user is in the team
CREATE OR REPLACE FUNCTION is_team_member(team_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members WHERE team_id = team_uuid AND user_id = auth.uid()
  );
$$;

-- is_team_owner(team_uuid) — Checks if current user owns the team
CREATE OR REPLACE FUNCTION is_team_owner(team_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teams WHERE id = team_uuid AND owner_id = auth.uid()
  );
$$;

-- get_project_limit(plan) — Returns project limit for a plan tier
CREATE OR REPLACE FUNCTION get_project_limit(plan_tier TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE plan_tier
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 5
    WHEN 'business' THEN 15
    WHEN 'enterprise' THEN 999999
    ELSE 0
  END;
END;
$$;


-- ============================================================================
-- 5. TRIGGER FUNCTIONS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Auto-create profile on new auth.users signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, avatar_url, subscription_status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    'incomplete'
  );
  RETURN NEW;
END;
$$;

-- Sync subscription changes to profiles table
CREATE OR REPLACE FUNCTION sync_subscription_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET
    plan = NEW.plan,
    subscription_status = NEW.status,
    updated_at = NOW()
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- Enforce team seat limits
CREATE OR REPLACE FUNCTION check_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_count INTEGER;
  max_allowed INTEGER;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM team_members WHERE team_id = NEW.team_id;

  SELECT max_seats INTO max_allowed
  FROM teams WHERE id = NEW.team_id;

  IF current_count >= max_allowed THEN
    RAISE EXCEPTION 'Team has reached maximum seat limit (%)', max_allowed;
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================================================
-- 6. RPC FUNCTIONS (called from app)
-- ============================================================================

-- Register a project (with plan limit check)
CREATE OR REPLACE FUNCTION register_project(p_path_hash TEXT, p_project_name TEXT, p_machine_id TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  user_plan TEXT;
  project_count INTEGER;
  project_limit INTEGER;
  existing_project user_projects%ROWTYPE;
  new_project user_projects%ROWTYPE;
BEGIN
  -- Check if this exact project already exists (re-adding a removed folder)
  SELECT * INTO existing_project
  FROM user_projects
  WHERE user_id = auth.uid() AND path_hash = p_path_hash;

  IF FOUND THEN
    -- Re-activate existing project
    UPDATE user_projects
    SET status = 'active',
        project_name = p_project_name,
        last_opened_at = now(),
        removed_at = NULL
    WHERE id = existing_project.id
    RETURNING * INTO new_project;

    RETURN json_build_object(
      'success', true,
      'reactivated', true,
      'project_id', new_project.id
    );
  END IF;

  -- New project — check limit
  SELECT plan INTO user_plan FROM profiles WHERE id = auth.uid();
  SELECT COUNT(*) INTO project_count FROM user_projects WHERE user_id = auth.uid();
  project_limit := get_project_limit(COALESCE(user_plan, 'starter'));

  IF project_count >= project_limit THEN
    RETURN json_build_object(
      'success', false,
      'error', 'project_limit_reached',
      'current', project_count,
      'limit', project_limit,
      'plan', COALESCE(user_plan, 'starter')
    );
  END IF;

  -- Insert new project
  INSERT INTO user_projects (user_id, path_hash, project_name, machine_id)
  VALUES (auth.uid(), p_path_hash, p_project_name, p_machine_id)
  RETURNING * INTO new_project;

  RETURN json_build_object(
    'success', true,
    'reactivated', false,
    'project_id', new_project.id
  );
END;
$$;

-- Deactivate a project
CREATE OR REPLACE FUNCTION deactivate_project(p_path_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_projects
  SET status = 'inactive',
      removed_at = now()
  WHERE user_id = auth.uid() AND path_hash = p_path_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'project_not_found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

-- Check project limit
CREATE OR REPLACE FUNCTION check_project_limit()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  user_plan TEXT;
  project_count INTEGER;
  project_limit INTEGER;
BEGIN
  SELECT plan INTO user_plan
  FROM profiles
  WHERE id = auth.uid();

  SELECT COUNT(*) INTO project_count
  FROM user_projects
  WHERE user_id = auth.uid();

  project_limit := get_project_limit(COALESCE(user_plan, 'starter'));

  RETURN json_build_object(
    'allowed', project_count < project_limit,
    'current', project_count,
    'limit', project_limit,
    'plan', COALESCE(user_plan, 'starter')
  );
END;
$$;


-- ============================================================================
-- 7. ADMIN ANALYTICS FUNCTIONS
-- ============================================================================

-- Top providers (last 30 days)
CREATE OR REPLACE FUNCTION get_top_providers()
RETURNS TABLE(provider TEXT, usage_count BIGINT, total_tokens BIGINT, total_cost NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    provider,
    COUNT(*) AS usage_count,
    COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
    COALESCE(SUM(estimated_cost), 0) AS total_cost
  FROM usage_events
  WHERE occurred_at >= NOW() - INTERVAL '30 days'
  GROUP BY provider
  ORDER BY usage_count DESC
  LIMIT 10;
$$;

-- Top models (last 30 days)
CREATE OR REPLACE FUNCTION get_top_models()
RETURNS TABLE(model TEXT, provider TEXT, usage_count BIGINT, total_tokens BIGINT, total_cost NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    model,
    provider,
    COUNT(*) AS usage_count,
    COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
    COALESCE(SUM(estimated_cost), 0) AS total_cost
  FROM usage_events
  WHERE occurred_at >= NOW() - INTERVAL '30 days'
  GROUP BY model, provider
  ORDER BY usage_count DESC
  LIMIT 10;
$$;

-- Total cost (last 30 days)
CREATE OR REPLACE FUNCTION get_total_cost()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(estimated_cost), 0)
  FROM usage_events
  WHERE occurred_at >= NOW() - INTERVAL '30 days';
$$;

-- Geographic distribution
CREATE OR REPLACE FUNCTION get_geo_distribution()
RETURNS TABLE(country TEXT, user_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    COALESCE(country, 'Unknown') AS country,
    COUNT(*) AS user_count
  FROM profiles
  WHERE country IS NOT NULL
  GROUP BY country
  ORDER BY user_count DESC
  LIMIT 20;
$$;


-- ============================================================================
-- 8. CLEANUP FUNCTIONS (used by pg_cron)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_stale_locks()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM project_locks
  WHERE last_heartbeat < NOW() - INTERVAL '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION mark_stale_devices_offline()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE devices
  SET is_online = FALSE
  WHERE is_online = TRUE AND last_heartbeat < NOW() - INTERVAL '2 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION expire_old_commands()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE remote_commands
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < NOW();
END;
$$;

CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE team_invitations
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < NOW();
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_expired_pairing_tokens()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM pairing_tokens
  WHERE is_paired = FALSE AND expires_at < NOW();
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_old_activity()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM team_activity_log
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_old_commands()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM remote_commands
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_old_webhook_events()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM stripe_webhook_events
  WHERE processed_at < NOW() - INTERVAL '90 days';
END;
$$;


-- ============================================================================
-- 9. TRIGGERS
-- ============================================================================

-- Auto-create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Sync subscription → profile
CREATE TRIGGER on_subscription_change
  AFTER INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION sync_subscription_to_profile();

-- Enforce seat limits
CREATE TRIGGER enforce_seat_limit
  BEFORE INSERT ON team_members
  FOR EACH ROW EXECUTE FUNCTION check_seat_limit();


-- ============================================================================
-- 10. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE synced_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE synced_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_projects ENABLE ROW LEVEL SECURITY;


-- ---------- profiles ----------
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Admins read all profiles" ON profiles FOR SELECT USING (is_admin());
CREATE POLICY "Admins update any profile" ON profiles FOR UPDATE USING (is_admin());
CREATE POLICY "Team members see teammates" ON profiles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM team_members tm1
    JOIN team_members tm2 ON tm1.team_id = tm2.team_id
    WHERE tm1.user_id = auth.uid() AND tm2.user_id = profiles.id
  ));

-- ---------- subscriptions ----------
CREATE POLICY "Users read own subscriptions" ON subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins read all subscriptions" ON subscriptions FOR SELECT USING (is_admin());

-- ---------- stripe_webhook_events ----------
-- No user access. Service role only.

-- ---------- teams ----------
CREATE POLICY "Members read own team" ON teams FOR SELECT USING (is_team_member(id));
CREATE POLICY "Admins read all teams" ON teams FOR SELECT USING (is_admin());
CREATE POLICY "Users create team" ON teams FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners update own team" ON teams FOR UPDATE USING (owner_id = auth.uid());

-- ---------- team_members ----------
CREATE POLICY "Members see team roster" ON team_members FOR SELECT USING (is_team_member(team_id));
CREATE POLICY "Admins read all members" ON team_members FOR SELECT USING (is_admin());
CREATE POLICY "Owners manage members" ON team_members FOR INSERT WITH CHECK (is_team_owner(team_id));
CREATE POLICY "Owners remove members" ON team_members FOR DELETE USING (is_team_owner(team_id));
CREATE POLICY "Members can leave" ON team_members FOR DELETE USING (user_id = auth.uid());

-- ---------- team_invitations ----------
CREATE POLICY "Owners create invitations" ON team_invitations FOR INSERT WITH CHECK (is_team_owner(team_id));
CREATE POLICY "Owners manage invitations" ON team_invitations FOR SELECT USING (is_team_owner(team_id));
CREATE POLICY "Owners cancel invitations" ON team_invitations FOR UPDATE USING (is_team_owner(team_id));
CREATE POLICY "Invitees see own invitations" ON team_invitations FOR SELECT
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid())::text);
CREATE POLICY "Admins read all invitations" ON team_invitations FOR SELECT USING (is_admin());

-- ---------- project_locks ----------
CREATE POLICY "Members see project locks" ON project_locks FOR SELECT USING (is_team_member(team_id));
CREATE POLICY "Members create locks" ON project_locks FOR INSERT WITH CHECK (is_team_member(team_id) AND locked_by = auth.uid());
CREATE POLICY "Lock holder updates lock" ON project_locks FOR UPDATE USING (locked_by = auth.uid());
CREATE POLICY "Lock holder or owner releases lock" ON project_locks FOR DELETE USING (locked_by = auth.uid() OR is_team_owner(team_id));
CREATE POLICY "Admins read all locks" ON project_locks FOR SELECT USING (is_admin());

-- ---------- team_activity_log ----------
CREATE POLICY "Members read team activity" ON team_activity_log FOR SELECT USING (is_team_member(team_id));
CREATE POLICY "Members insert activity" ON team_activity_log FOR INSERT WITH CHECK (is_team_member(team_id) AND user_id = auth.uid());
CREATE POLICY "Admins read all activity" ON team_activity_log FOR SELECT USING (is_admin());

-- ---------- usage_events ----------
CREATE POLICY "Users read own usage" ON usage_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own usage" ON usage_events FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read all usage" ON usage_events FOR SELECT USING (is_admin());

-- ---------- feature_events ----------
CREATE POLICY "Users read own features" ON feature_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own features" ON feature_events FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read all features" ON feature_events FOR SELECT USING (is_admin());

-- ---------- app_sessions ----------
CREATE POLICY "Users read own sessions" ON app_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own sessions" ON app_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own sessions" ON app_sessions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Admins read all sessions" ON app_sessions FOR SELECT USING (is_admin());

-- ---------- devices ----------
CREATE POLICY "Users manage own devices" ON devices FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read all devices" ON devices FOR SELECT USING (is_admin());

-- ---------- remote_commands ----------
CREATE POLICY "Users manage own commands" ON remote_commands FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- pairing_tokens ----------
CREATE POLICY "Users manage own pairing" ON pairing_tokens FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- synced_projects ----------
CREATE POLICY "Users manage own synced projects" ON synced_projects FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- synced_tasks ----------
CREATE POLICY "Users manage own synced tasks" ON synced_tasks FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- admin_audit_log ----------
CREATE POLICY "Admins only" ON admin_audit_log FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ---------- user_projects ----------
CREATE POLICY "Users can read own projects" ON user_projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can register projects" ON user_projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects" ON user_projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can read all projects" ON user_projects FOR SELECT USING (is_admin());


-- ============================================================================
-- 11. REALTIME
-- ============================================================================

-- Enable Realtime for tables that need live updates
ALTER PUBLICATION supabase_realtime ADD TABLE remote_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE devices;
ALTER PUBLICATION supabase_realtime ADD TABLE synced_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE project_locks;


-- ============================================================================
-- 12. PG_CRON SCHEDULED JOBS
-- (Requires pg_cron extension enabled in Supabase Dashboard)
-- ============================================================================

-- Uncomment these after enabling pg_cron:

-- SELECT cron.schedule('cleanup-stale-locks', '* * * * *', 'SELECT cleanup_stale_locks()');
-- SELECT cron.schedule('mark-stale-devices', '* * * * *', 'SELECT mark_stale_devices_offline()');
-- SELECT cron.schedule('expire-commands', '* * * * *', 'SELECT expire_old_commands()');
-- SELECT cron.schedule('expire-invitations', '0 * * * *', 'SELECT expire_old_invitations()');
-- SELECT cron.schedule('cleanup-pairing', '0 * * * *', 'SELECT cleanup_expired_pairing_tokens()');
-- SELECT cron.schedule('cleanup-activity', '0 3 * * *', 'SELECT cleanup_old_activity()');
-- SELECT cron.schedule('cleanup-old-commands', '0 3 * * *', 'SELECT cleanup_old_commands()');
-- SELECT cron.schedule('cleanup-webhooks', '0 4 * * 0', 'SELECT cleanup_old_webhook_events()');


-- ============================================================================
-- END OF FULL SCHEMA
-- ============================================================================