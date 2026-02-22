-- ============================================================================
-- Mydevify — Delta Migration (v2 improvements)
-- Run on existing database — February 20, 2026
--
-- Changes:
--   1. Add auth_provider column to profiles
--   2. Drop one-team-per-user constraint (multi-team support)
--   3. Add commands_run + tools_used columns to app_sessions
--   4. Add admin analytics views (cohort retention, trial conversion,
--      power users, revenue at risk, feature adoption)
--   5. Add missing RLS for stripe_webhook_events (explicit deny)
-- ============================================================================


-- ============================================================================
-- 1. PROFILES: Add auth_provider column
--    Tracks how they signed up (email, google, github, magic_link).
--    signup_source stays for "how did you hear about us" (self-reported).
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email';

COMMENT ON COLUMN profiles.auth_provider IS 'Auth method used at signup: email, google, github, magic_link. Auto-set by handle_new_user trigger.';
COMMENT ON COLUMN profiles.signup_source IS 'Self-reported: how they heard about Mydevify (twitter, reddit, producthunt, youtube, friend, google_search, other). From onboarding dropdown.';

-- Update handle_new_user() to auto-detect auth provider
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  detected_provider TEXT;
BEGIN
  -- Detect auth provider from Supabase auth metadata
  detected_provider := COALESCE(
    NEW.raw_app_meta_data->>'provider',
    'email'
  );

  INSERT INTO profiles (id, email, display_name, avatar_url, auth_provider, subscription_status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    detected_provider,
    'incomplete'
  );
  RETURN NEW;
END;
$$;


-- ============================================================================
-- 2. MULTI-TEAM SUPPORT: Drop the one-team-per-user constraint
--    Keeps team_id+user_id unique (can't join same team twice).
--    App still enforces single team for MVP — DB just doesn't block future.
-- ============================================================================

-- Drop the unique index on user_id alone
DROP INDEX IF EXISTS team_members_user_id_key;

-- Drop the unique constraint on user_id alone
ALTER TABLE team_members
  DROP CONSTRAINT IF EXISTS team_members_user_id_key;


-- ============================================================================
-- 3. APP_SESSIONS: Add activity tracking columns
--    Individual columns instead of jsonb for easy aggregation.
-- ============================================================================

ALTER TABLE app_sessions
  ADD COLUMN IF NOT EXISTS commands_run INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tools_used INTEGER NOT NULL DEFAULT 0;


-- ============================================================================
-- 4. ADMIN ANALYTICS VIEWS
--    These are regular views (not materialized) — always fresh data.
--    Only callable by admins via RPC or direct query with service role.
-- ============================================================================


-- --------------------------------------------------------------------------
-- 4.1 Cohort Retention — Monthly signup cohorts and their retention
-- Shows: users who signed up in month X, how many are still active in months Y
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_cohort_retention AS
SELECT
  to_char(p.created_at, 'YYYY-MM') AS cohort_month,
  COUNT(DISTINCT p.id) AS cohort_size,
  COUNT(DISTINCT CASE
    WHEN s.started_at >= p.created_at
     AND s.started_at < p.created_at + INTERVAL '30 days'
    THEN p.id
  END) AS active_month_0,
  COUNT(DISTINCT CASE
    WHEN s.started_at >= p.created_at + INTERVAL '30 days'
     AND s.started_at < p.created_at + INTERVAL '60 days'
    THEN p.id
  END) AS active_month_1,
  COUNT(DISTINCT CASE
    WHEN s.started_at >= p.created_at + INTERVAL '60 days'
     AND s.started_at < p.created_at + INTERVAL '90 days'
    THEN p.id
  END) AS active_month_2,
  COUNT(DISTINCT CASE
    WHEN s.started_at >= p.created_at + INTERVAL '90 days'
     AND s.started_at < p.created_at + INTERVAL '120 days'
    THEN p.id
  END) AS active_month_3,
  COUNT(DISTINCT CASE
    WHEN s.started_at >= p.created_at + INTERVAL '120 days'
     AND s.started_at < p.created_at + INTERVAL '150 days'
    THEN p.id
  END) AS active_month_4,
  COUNT(DISTINCT CASE
    WHEN s.started_at >= p.created_at + INTERVAL '150 days'
     AND s.started_at < p.created_at + INTERVAL '180 days'
    THEN p.id
  END) AS active_month_5
FROM profiles p
LEFT JOIN app_sessions s ON s.user_id = p.id
GROUP BY to_char(p.created_at, 'YYYY-MM')
ORDER BY cohort_month DESC;


-- --------------------------------------------------------------------------
-- 4.2 Trial Conversion Funnel
-- Shows: trial users, who converted, what day they converted, what plan
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_trial_conversions AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.auth_provider,
  p.signup_source,
  p.created_at AS signed_up_at,
  p.trial_started_at,
  p.trial_ends_at,
  p.plan AS current_plan,
  p.subscription_status,
  sub.plan AS subscribed_plan,
  sub.billing_interval,
  sub.created_at AS subscription_created_at,
  -- Days from signup to paid conversion (NULL if not converted)
  EXTRACT(DAY FROM (sub.created_at - p.created_at))::INTEGER AS days_to_convert,
  -- Status bucket
  CASE
    WHEN p.subscription_status IN ('active', 'trialing') AND p.plan != 'starter' THEN 'converted'
    WHEN p.subscription_status = 'trialing' THEN 'in_trial'
    WHEN p.subscription_status IN ('canceled', 'incomplete_expired') THEN 'churned'
    WHEN p.trial_ends_at < NOW() AND p.subscription_status = 'incomplete' THEN 'trial_expired'
    ELSE 'other'
  END AS funnel_stage
FROM profiles p
LEFT JOIN subscriptions sub ON sub.user_id = p.id AND sub.status = 'active'
ORDER BY p.created_at DESC;


-- --------------------------------------------------------------------------
-- 4.3 Power Users — Ranked by engagement (last 30 days)
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_power_users AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.plan,
  p.subscription_status,
  p.country,
  p.last_active_at,
  -- Session metrics (last 30 days)
  COUNT(DISTINCT s.id) AS sessions_30d,
  COALESCE(SUM(s.messages_sent), 0) AS messages_30d,
  COALESCE(SUM(s.files_modified), 0) AS files_modified_30d,
  COALESCE(SUM(s.deploys), 0) AS deploys_30d,
  COALESCE(SUM(s.duration_seconds), 0) / 3600.0 AS hours_30d,
  -- Token usage (last 30 days)
  COALESCE(SUM(u.input_tokens + u.output_tokens), 0) AS total_tokens_30d,
  COALESCE(SUM(u.estimated_cost), 0) AS total_cost_30d,
  -- Feature diversity (how many different features used)
  COUNT(DISTINCT f.feature) AS unique_features_30d
FROM profiles p
LEFT JOIN app_sessions s
  ON s.user_id = p.id AND s.started_at >= NOW() - INTERVAL '30 days'
LEFT JOIN usage_events u
  ON u.user_id = p.id AND u.occurred_at >= NOW() - INTERVAL '30 days'
LEFT JOIN feature_events f
  ON f.user_id = p.id AND f.occurred_at >= NOW() - INTERVAL '30 days'
GROUP BY p.id, p.email, p.display_name, p.plan, p.subscription_status, p.country, p.last_active_at
ORDER BY sessions_30d DESC, total_tokens_30d DESC;


-- --------------------------------------------------------------------------
-- 4.4 Revenue at Risk — Paid users inactive 14+ days
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_revenue_at_risk AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.plan,
  p.subscription_status,
  sub.billing_interval,
  sub.current_period_end,
  p.last_active_at,
  EXTRACT(DAY FROM (NOW() - p.last_active_at))::INTEGER AS days_inactive,
  p.total_sessions,
  p.country,
  p.os,
  -- Estimated monthly revenue from this user
  CASE
    WHEN p.plan = 'starter' AND sub.billing_interval = 'monthly' THEN 39
    WHEN p.plan = 'starter' AND sub.billing_interval = 'yearly' THEN 32.50
    WHEN p.plan = 'pro' AND sub.billing_interval = 'monthly' THEN 69
    WHEN p.plan = 'pro' AND sub.billing_interval = 'yearly' THEN 57.50
    WHEN p.plan = 'business' AND sub.billing_interval = 'monthly' THEN 199
    WHEN p.plan = 'business' AND sub.billing_interval = 'yearly' THEN 165.83
    ELSE 0
  END AS monthly_revenue_at_risk
FROM profiles p
JOIN subscriptions sub ON sub.user_id = p.id AND sub.status IN ('active', 'trialing')
WHERE p.last_active_at < NOW() - INTERVAL '14 days'
  AND p.subscription_status IN ('active', 'trialing')
ORDER BY monthly_revenue_at_risk DESC, days_inactive DESC;


-- --------------------------------------------------------------------------
-- 4.5 Feature Adoption — Which features are used, how often, by how many
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_feature_adoption AS
SELECT
  feature,
  COUNT(*) AS total_uses,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '7 days') AS uses_7d,
  COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '30 days') AS uses_30d,
  COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= NOW() - INTERVAL '30 days') AS unique_users_30d,
  MIN(occurred_at) AS first_used,
  MAX(occurred_at) AS last_used
FROM feature_events
GROUP BY feature
ORDER BY uses_30d DESC;


-- --------------------------------------------------------------------------
-- 4.6 User Overview — The main admin user list with everything
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_user_overview AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.plan,
  p.subscription_status,
  p.auth_provider,
  p.signup_source,
  p.app_version,
  p.os,
  p.country,
  p.timezone,
  p.is_banned,
  p.is_admin,
  p.admin_notes,
  p.trial_started_at,
  p.trial_ends_at,
  p.last_active_at,
  p.total_sessions,
  p.created_at AS signed_up_at,
  -- Subscription details
  sub.billing_interval,
  sub.current_period_end,
  sub.cancel_at,
  sub.trial_start AS sub_trial_start,
  sub.trial_end AS sub_trial_end,
  -- Usage summary (lifetime)
  COALESCE(usage.total_tokens, 0) AS lifetime_tokens,
  COALESCE(usage.total_cost, 0) AS lifetime_cost,
  COALESCE(usage.total_calls, 0) AS lifetime_api_calls,
  -- Usage summary (last 30 days)
  COALESCE(usage_30d.total_tokens, 0) AS tokens_30d,
  COALESCE(usage_30d.total_cost, 0) AS cost_30d,
  -- Top provider for this user
  usage.top_provider,
  usage.top_model,
  -- Project count
  COALESCE(projects.project_count, 0) AS project_count,
  -- Team info
  tm.team_name,
  tm.team_role
FROM profiles p
-- Active subscription
LEFT JOIN subscriptions sub
  ON sub.user_id = p.id AND sub.status IN ('active', 'trialing', 'past_due')
-- Lifetime usage
LEFT JOIN LATERAL (
  SELECT
    SUM(input_tokens + output_tokens) AS total_tokens,
    SUM(estimated_cost) AS total_cost,
    COUNT(*) AS total_calls,
    (SELECT provider FROM usage_events WHERE user_id = p.id GROUP BY provider ORDER BY COUNT(*) DESC LIMIT 1) AS top_provider,
    (SELECT model FROM usage_events WHERE user_id = p.id GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) AS top_model
  FROM usage_events WHERE user_id = p.id
) usage ON TRUE
-- 30-day usage
LEFT JOIN LATERAL (
  SELECT
    SUM(input_tokens + output_tokens) AS total_tokens,
    SUM(estimated_cost) AS total_cost
  FROM usage_events
  WHERE user_id = p.id AND occurred_at >= NOW() - INTERVAL '30 days'
) usage_30d ON TRUE
-- Project count
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS project_count
  FROM user_projects
  WHERE user_id = p.id AND status = 'active'
) projects ON TRUE
-- Team membership
LEFT JOIN LATERAL (
  SELECT t.name AS team_name, tmem.role::TEXT AS team_role
  FROM team_members tmem
  JOIN teams t ON t.id = tmem.team_id
  WHERE tmem.user_id = p.id
  LIMIT 1
) tm ON TRUE
ORDER BY p.created_at DESC;


-- --------------------------------------------------------------------------
-- 4.7 Revenue Dashboard — MRR, plan distribution, signup trends
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_revenue_summary AS
SELECT
  -- Total users
  (SELECT COUNT(*) FROM profiles) AS total_users,
  (SELECT COUNT(*) FROM profiles WHERE created_at >= NOW() - INTERVAL '30 days') AS signups_30d,
  (SELECT COUNT(*) FROM profiles WHERE created_at >= NOW() - INTERVAL '7 days') AS signups_7d,

  -- Active subscriptions by plan
  (SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing')) AS active_subscriptions,
  (SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing') AND plan = 'starter') AS starter_count,
  (SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing') AND plan = 'pro') AS pro_count,
  (SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing') AND plan = 'business') AS business_count,
  (SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing') AND plan = 'enterprise') AS enterprise_count,

  -- MRR calculation (monthly equivalent)
  (SELECT COALESCE(SUM(
    CASE
      WHEN plan = 'starter' AND billing_interval = 'monthly' THEN 39
      WHEN plan = 'starter' AND billing_interval = 'yearly' THEN 32.50
      WHEN plan = 'pro' AND billing_interval = 'monthly' THEN 69
      WHEN plan = 'pro' AND billing_interval = 'yearly' THEN 57.50
      WHEN plan = 'business' AND billing_interval = 'monthly' THEN 199
      WHEN plan = 'business' AND billing_interval = 'yearly' THEN 165.83
      ELSE 0
    END
  ), 0) FROM subscriptions WHERE status IN ('active', 'trialing')) AS mrr,

  -- Trials
  (SELECT COUNT(*) FROM profiles WHERE subscription_status = 'trialing') AS active_trials,
  (SELECT COUNT(*) FROM profiles WHERE subscription_status = 'incomplete' AND trial_ends_at < NOW()) AS expired_trials,

  -- Churn (last 30 days)
  (SELECT COUNT(*) FROM subscriptions WHERE status = 'canceled' AND canceled_at >= NOW() - INTERVAL '30 days') AS churned_30d,

  -- DAU / WAU / MAU
  (SELECT COUNT(DISTINCT user_id) FROM app_sessions WHERE started_at >= NOW() - INTERVAL '1 day') AS dau,
  (SELECT COUNT(DISTINCT user_id) FROM app_sessions WHERE started_at >= NOW() - INTERVAL '7 days') AS wau,
  (SELECT COUNT(DISTINCT user_id) FROM app_sessions WHERE started_at >= NOW() - INTERVAL '30 days') AS mau;


-- ============================================================================
-- 5. RLS FOR ADMIN VIEWS
-- Views inherit RLS from underlying tables, so admin-only access is
-- already enforced. But for extra safety, wrap in functions:
-- ============================================================================

-- Wrapper function for admin-only view access
CREATE OR REPLACE FUNCTION admin_get_revenue_summary()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN (SELECT row_to_json(r) FROM admin_revenue_summary r);
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_users_at_risk()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN (SELECT json_agg(r) FROM admin_revenue_at_risk r);
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_feature_adoption()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN (SELECT json_agg(r) FROM admin_feature_adoption r);
END;
$$;


-- ============================================================================
-- 6. DETAILED USAGE VIEWS (token consumption, providers, models per user)
-- ============================================================================


-- --------------------------------------------------------------------------
-- 6.1 Per-user usage detail — all providers/models, token breakdown
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_user_usage_detail AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.plan,
  u_summary.providers_used,
  u_summary.models_used,
  COALESCE(u_summary.lifetime_input_tokens, 0) AS lifetime_input_tokens,
  COALESCE(u_summary.lifetime_output_tokens, 0) AS lifetime_output_tokens,
  COALESCE(u_summary.lifetime_cache_read_tokens, 0) AS lifetime_cache_read_tokens,
  COALESCE(u_summary.lifetime_cache_write_tokens, 0) AS lifetime_cache_write_tokens,
  COALESCE(u_summary.lifetime_total_tokens, 0) AS lifetime_total_tokens,
  COALESCE(u_summary.lifetime_cost, 0) AS lifetime_cost,
  COALESCE(u_summary.lifetime_api_calls, 0) AS lifetime_api_calls,
  COALESCE(u_30d.tokens_30d, 0) AS tokens_30d,
  COALESCE(u_30d.cost_30d, 0) AS cost_30d,
  COALESCE(u_30d.calls_30d, 0) AS calls_30d,
  COALESCE(u_7d.tokens_7d, 0) AS tokens_7d,
  COALESCE(u_7d.cost_7d, 0) AS cost_7d
FROM profiles p
LEFT JOIN LATERAL (
  SELECT
    array_agg(DISTINCT provider) AS providers_used,
    array_agg(DISTINCT model) AS models_used,
    SUM(input_tokens) AS lifetime_input_tokens,
    SUM(output_tokens) AS lifetime_output_tokens,
    SUM(cache_read_tokens) AS lifetime_cache_read_tokens,
    SUM(cache_write_tokens) AS lifetime_cache_write_tokens,
    SUM(input_tokens + output_tokens) AS lifetime_total_tokens,
    SUM(estimated_cost) AS lifetime_cost,
    COUNT(*) AS lifetime_api_calls
  FROM usage_events WHERE user_id = p.id
) u_summary ON TRUE
LEFT JOIN LATERAL (
  SELECT
    SUM(input_tokens + output_tokens) AS tokens_30d,
    SUM(estimated_cost) AS cost_30d,
    COUNT(*) AS calls_30d
  FROM usage_events
  WHERE user_id = p.id AND occurred_at >= NOW() - INTERVAL '30 days'
) u_30d ON TRUE
LEFT JOIN LATERAL (
  SELECT
    SUM(input_tokens + output_tokens) AS tokens_7d,
    SUM(estimated_cost) AS cost_7d
  FROM usage_events
  WHERE user_id = p.id AND occurred_at >= NOW() - INTERVAL '7 days'
) u_7d ON TRUE
ORDER BY lifetime_cost DESC;


-- --------------------------------------------------------------------------
-- 6.2 Per-user per-provider+model breakdown (drill-down view)
-- One row per user + provider + model combo
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_user_provider_breakdown AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.plan,
  u.provider,
  u.model,
  COUNT(*) AS api_calls,
  SUM(u.input_tokens) AS input_tokens,
  SUM(u.output_tokens) AS output_tokens,
  SUM(u.cache_read_tokens) AS cache_read_tokens,
  SUM(u.cache_write_tokens) AS cache_write_tokens,
  SUM(u.input_tokens + u.output_tokens) AS total_tokens,
  SUM(u.estimated_cost) AS total_cost,
  MIN(u.occurred_at) AS first_used,
  MAX(u.occurred_at) AS last_used
FROM profiles p
JOIN usage_events u ON u.user_id = p.id
GROUP BY p.id, p.email, p.display_name, p.plan, u.provider, u.model
ORDER BY p.email, total_cost DESC;


-- --------------------------------------------------------------------------
-- 6.3 Updated admin_user_overview — now includes providers_used/models_used
-- --------------------------------------------------------------------------
DROP VIEW IF EXISTS admin_user_overview;

CREATE OR REPLACE VIEW admin_user_overview AS
SELECT
  p.id AS user_id,
  p.email,
  p.display_name,
  p.plan,
  p.subscription_status,
  p.auth_provider,
  p.signup_source,
  p.app_version,
  p.os,
  p.country,
  p.timezone,
  p.is_banned,
  p.is_admin,
  p.admin_notes,
  p.trial_started_at,
  p.trial_ends_at,
  p.last_active_at,
  p.total_sessions,
  p.created_at AS signed_up_at,
  sub.billing_interval,
  sub.current_period_end,
  sub.cancel_at,
  -- All providers & models used (arrays)
  usage.providers_used,
  usage.models_used,
  usage.top_provider,
  usage.top_model,
  -- Usage (lifetime)
  COALESCE(usage.total_tokens, 0) AS lifetime_tokens,
  COALESCE(usage.total_cost, 0) AS lifetime_cost,
  COALESCE(usage.total_calls, 0) AS lifetime_api_calls,
  -- Usage (last 30 days)
  COALESCE(usage_30d.total_tokens, 0) AS tokens_30d,
  COALESCE(usage_30d.total_cost, 0) AS cost_30d,
  -- Projects
  COALESCE(projects.project_count, 0) AS project_count,
  -- Team
  tm.team_name,
  tm.team_role
FROM profiles p
LEFT JOIN subscriptions sub
  ON sub.user_id = p.id AND sub.status IN ('active', 'trialing', 'past_due')
LEFT JOIN LATERAL (
  SELECT
    array_agg(DISTINCT provider) AS providers_used,
    array_agg(DISTINCT model) AS models_used,
    SUM(input_tokens + output_tokens) AS total_tokens,
    SUM(estimated_cost) AS total_cost,
    COUNT(*) AS total_calls,
    (SELECT provider FROM usage_events WHERE user_id = p.id GROUP BY provider ORDER BY COUNT(*) DESC LIMIT 1) AS top_provider,
    (SELECT model FROM usage_events WHERE user_id = p.id GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) AS top_model
  FROM usage_events WHERE user_id = p.id
) usage ON TRUE
LEFT JOIN LATERAL (
  SELECT
    SUM(input_tokens + output_tokens) AS total_tokens,
    SUM(estimated_cost) AS total_cost
  FROM usage_events
  WHERE user_id = p.id AND occurred_at >= NOW() - INTERVAL '30 days'
) usage_30d ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS project_count
  FROM user_projects
  WHERE user_id = p.id AND status = 'active'
) projects ON TRUE
LEFT JOIN LATERAL (
  SELECT t.name AS team_name, tmem.role::TEXT AS team_role
  FROM team_members tmem
  JOIN teams t ON t.id = tmem.team_id
  WHERE tmem.user_id = p.id
  LIMIT 1
) tm ON TRUE
ORDER BY p.created_at DESC;


-- ============================================================================
-- DONE
-- ============================================================================
-- Summary of changes:
--   + profiles.auth_provider column (auto-detected from Supabase auth)
--   + handle_new_user() updated to set auth_provider
--   - team_members_user_id_key constraint DROPPED (multi-team ready)
--   + app_sessions.commands_run column
--   + app_sessions.tools_used column
--   + 9 admin analytics views:
--       - admin_cohort_retention (monthly signup cohorts + retention)
--       - admin_trial_conversions (trial → paid funnel)
--       - admin_power_users (ranked by engagement)
--       - admin_revenue_at_risk (paid users gone inactive)
--       - admin_feature_adoption (which features, how often, by whom)
--       - admin_user_overview (the big one — everything per user)
--       - admin_revenue_summary (MRR, DAU/WAU/MAU, plan distribution)
--       - admin_user_usage_detail (per-user token breakdown)
--       - admin_user_provider_breakdown (per-user per-provider drill-down)
--   + 3 admin wrapper functions
-- ============================================================================