-- ============================================================
-- Migration 015: Revert 014 (effective plan)
-- ============================================================
-- Restores original check_project_limit and register_project
-- functions, drops get_effective_plan and get_templates_for_user.
-- These will be rebuilt in 016 with multi-team support.
-- ============================================================


-- 1. Restore original check_project_limit

CREATE OR REPLACE FUNCTION public.check_project_limit()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $fn1$
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
$fn1$;


-- 2. Restore original register_project

CREATE OR REPLACE FUNCTION public.register_project(
  p_path_hash text,
  p_project_name text,
  p_machine_id text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $fn2$
DECLARE
  user_plan TEXT;
  project_count INTEGER;
  project_limit INTEGER;
  existing_project user_projects%ROWTYPE;
  new_project user_projects%ROWTYPE;
BEGIN
  SELECT * INTO existing_project
  FROM user_projects
  WHERE user_id = auth.uid() AND path_hash = p_path_hash;

  IF FOUND THEN
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

  INSERT INTO user_projects (user_id, path_hash, project_name, machine_id)
  VALUES (auth.uid(), p_path_hash, p_project_name, p_machine_id)
  RETURNING * INTO new_project;

  RETURN json_build_object(
    'success', true,
    'reactivated', false,
    'project_id', new_project.id
  );
END;
$fn2$;


-- 3. Drop functions added in 014

DROP FUNCTION IF EXISTS public.get_effective_plan(uuid);
DROP FUNCTION IF EXISTS public.get_templates_for_user();