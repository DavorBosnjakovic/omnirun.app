-- ============================================================
-- Migration 014: Team-aware effective plan
-- ============================================================

-- 1. Core function: get_effective_plan

CREATE OR REPLACE FUNCTION public.get_effective_plan(user_uuid uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $fn1$
DECLARE
  v_plan TEXT;
BEGIN
  v_plan := (
    SELECT t.plan::text
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = user_uuid
    LIMIT 1
  );

  IF v_plan IS NOT NULL THEN
    RETURN v_plan;
  END IF;

  v_plan := (
    SELECT p.plan::text
    FROM profiles p
    WHERE p.id = user_uuid
  );

  RETURN COALESCE(v_plan, 'starter');
END;
$fn1$;

ALTER FUNCTION public.get_effective_plan(uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_effective_plan(uuid) TO anon;
GRANT ALL ON FUNCTION public.get_effective_plan(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_effective_plan(uuid) TO service_role;


-- 2. Update check_project_limit

CREATE OR REPLACE FUNCTION public.check_project_limit()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $fn2$
DECLARE
  v_effective_plan TEXT;
  v_project_count INTEGER;
  v_project_limit INTEGER;
BEGIN
  v_effective_plan := public.get_effective_plan(auth.uid());

  v_project_count := (
    SELECT COUNT(*)
    FROM user_projects
    WHERE user_id = auth.uid()
  );

  v_project_limit := public.get_project_limit(v_effective_plan);

  RETURN json_build_object(
    'allowed', v_project_count < v_project_limit,
    'current', v_project_count,
    'limit', v_project_limit,
    'plan', v_effective_plan
  );
END;
$fn2$;


-- 3. Update register_project

CREATE OR REPLACE FUNCTION public.register_project(
  p_path_hash text,
  p_project_name text,
  p_machine_id text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $fn3$
DECLARE
  v_effective_plan TEXT;
  v_project_count INTEGER;
  v_project_limit INTEGER;
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  -- Check if this exact project already exists
  v_existing_id := (
    SELECT id FROM user_projects
    WHERE user_id = auth.uid() AND path_hash = p_path_hash
    LIMIT 1
  );

  IF v_existing_id IS NOT NULL THEN
    UPDATE user_projects
    SET status = 'active',
        project_name = p_project_name,
        last_opened_at = now(),
        removed_at = NULL
    WHERE id = v_existing_id;

    RETURN json_build_object(
      'success', true,
      'reactivated', true,
      'project_id', v_existing_id
    );
  END IF;

  -- New project: check limit using effective plan
  v_effective_plan := public.get_effective_plan(auth.uid());

  v_project_count := (
    SELECT COUNT(*) FROM user_projects WHERE user_id = auth.uid()
  );

  v_project_limit := public.get_project_limit(v_effective_plan);

  IF v_project_count >= v_project_limit THEN
    RETURN json_build_object(
      'success', false,
      'error', 'project_limit_reached',
      'current', v_project_count,
      'limit', v_project_limit,
      'plan', v_effective_plan
    );
  END IF;

  INSERT INTO user_projects (user_id, path_hash, project_name, machine_id)
  VALUES (auth.uid(), p_path_hash, p_project_name, p_machine_id)
  RETURNING id INTO v_new_id;

  RETURN json_build_object(
    'success', true,
    'reactivated', false,
    'project_id', v_new_id
  );
END;
$fn3$;


-- 4. New helper: get_templates_for_user

CREATE OR REPLACE FUNCTION public.get_templates_for_user()
RETURNS SETOF public.templates
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $fn4$
DECLARE
  v_effective_plan TEXT;
BEGIN
  v_effective_plan := public.get_effective_plan(auth.uid());

  RETURN QUERY
  SELECT *
  FROM templates
  WHERE is_active = TRUE
    AND (
      tier = 'basic'
      OR (tier = 'pro' AND v_effective_plan IN ('pro', 'business', 'enterprise'))
      OR (tier = 'custom' AND v_effective_plan = 'enterprise')
    )
  ORDER BY category, sort_order, name;
END;
$fn4$;

ALTER FUNCTION public.get_templates_for_user() OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_templates_for_user() TO anon;
GRANT ALL ON FUNCTION public.get_templates_for_user() TO authenticated;
GRANT ALL ON FUNCTION public.get_templates_for_user() TO service_role;