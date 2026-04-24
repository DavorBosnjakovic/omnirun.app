-- ============================================================
-- Migration 017: Plan single source of truth
-- ============================================================
-- Problems fixed:
-- 1. teams.plan set at creation, never synced with Stripe
-- 2. Canceled users still get plan-gated features
-- 3. get_effective_plan reads stale teams.plan
--
-- Rules:
-- - profiles.plan stays as-is on cancellation (for resubscribe UX)
-- - get_effective_plan checks subscription_status: if not
--   active/trialing, returns 'none' which gives zero access
-- - profiles.plan is the source of truth, cascades to teams
-- ============================================================


-- 1. Fix sync_subscription_to_profile
-- Only update plan when subscription is active/trialing.
-- On cancellation, just update the status (keep plan for records).

CREATE OR REPLACE FUNCTION public.sync_subscription_to_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
BEGIN
  IF NEW.status IN ('active', 'trialing') THEN
    -- Active subscription: sync plan and status
    UPDATE profiles
    SET
      plan = NEW.plan,
      subscription_status = NEW.status,
      updated_at = NOW()
    WHERE id = NEW.user_id;
  ELSE
    -- Canceled/unpaid/etc: only update status, keep plan for records
    UPDATE profiles
    SET
      subscription_status = NEW.status,
      updated_at = NOW()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$fn$;


-- 2. Cascade profile plan changes to teams
-- When profiles.plan changes, update teams owned by this user

CREATE OR REPLACE FUNCTION public.sync_plan_to_teams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
BEGIN
  IF OLD.plan IS DISTINCT FROM NEW.plan THEN
    UPDATE teams
    SET
      plan = NEW.plan,
      max_seats = CASE NEW.plan::text
        WHEN 'starter' THEN 1
        WHEN 'pro' THEN 1
        WHEN 'studio' THEN 1
        WHEN 'team' THEN 5
        WHEN 'business' THEN 15
        WHEN 'enterprise' THEN 999999
        ELSE 1
      END,
      updated_at = NOW()
    WHERE owner_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER sync_plan_to_teams_trigger
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_plan_to_teams();


-- 3. Fix get_effective_plan
-- Reads owner's profiles.plan instead of teams.plan.
-- Returns 'none' if subscription is not active/trialing.
-- 'none' falls through to ELSE 0 in get_project_limit.

CREATE OR REPLACE FUNCTION public.get_effective_plan(p_team_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $fn$
DECLARE
  v_plan TEXT;
  v_status TEXT;
BEGIN
  IF p_team_id IS NOT NULL THEN
    -- Team context: use team owner's plan + status
    SELECT p.plan::text, p.subscription_status::text
    INTO v_plan, v_status
    FROM profiles p
    JOIN teams t ON t.owner_id = p.id
    WHERE t.id = p_team_id;

    IF v_plan IS NOT NULL THEN
      IF v_status NOT IN ('active', 'trialing') THEN
        RETURN 'none';
      END IF;
      RETURN v_plan;
    END IF;
  END IF;

  -- Personal context: own plan + status
  SELECT p.plan::text, p.subscription_status::text
  INTO v_plan, v_status
  FROM profiles p
  WHERE p.id = auth.uid();

  IF v_status NOT IN ('active', 'trialing') THEN
    RETURN 'none';
  END IF;

  RETURN COALESCE(v_plan, 'none');
END;
$fn$;


-- 4. One-time data fix: sync teams.plan and max_seats
-- from owner's current profiles.plan

UPDATE teams t
SET
  plan = p.plan,
  max_seats = CASE p.plan::text
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 1
    WHEN 'studio' THEN 1
    WHEN 'team' THEN 5
    WHEN 'business' THEN 15
    WHEN 'enterprise' THEN 999999
    ELSE 1
  END,
  updated_at = NOW()
FROM profiles p
WHERE p.id = t.owner_id;