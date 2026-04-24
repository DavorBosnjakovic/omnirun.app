-- ============================================================
-- Migration 016: Multi-team support
-- ============================================================
-- Allows users to be on multiple teams AND have a personal plan.
-- Projects belong to a context: personal (team_id NULL) or a team.
-- Plan-gated functions now take team context.
-- ============================================================


-- 1. Add team_id to user_projects (NULL = personal project)

ALTER TABLE public.user_projects
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_projects_team
  ON public.user_projects (team_id) WHERE team_id IS NOT NULL;


-- 2. RLS: team members can see/manage team projects

CREATE POLICY "Team members can read team projects"
  ON public.user_projects FOR SELECT
  USING (
    team_id IS NOT NULL
    AND public.is_team_member(team_id)
  );

CREATE POLICY "Team members can register team projects"
  ON public.user_projects FOR INSERT
  WITH CHECK (
    team_id IS NOT NULL
    AND public.is_team_member(team_id)
  );

CREATE POLICY "Team members can update team projects"
  ON public.user_projects FOR UPDATE
  USING (
    team_id IS NOT NULL
    AND public.is_team_member(team_id)
  );


-- 3. get_effective_plan (context-aware)
-- NULL team_id = personal plan, otherwise team plan

CREATE OR REPLACE FUNCTION public.get_effective_plan(p_team_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $fn$
DECLARE
  v_plan TEXT;
BEGIN
  IF p_team_id IS NOT NULL THEN
    v_plan := (
      SELECT t.plan::text
      FROM teams t
      WHERE t.id = p_team_id
    );
    IF v_plan IS NOT NULL THEN
      RETURN v_plan;
    END IF;
  END IF;

  v_plan := (
    SELECT p.plan::text
    FROM profiles p
    WHERE p.id = auth.uid()
  );

  RETURN COALESCE(v_plan, 'starter');
END;
$fn$;

ALTER FUNCTION public.get_effective_plan(uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_effective_plan(uuid) TO anon;
GRANT ALL ON FUNCTION public.get_effective_plan(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_effective_plan(uuid) TO service_role;


-- 4. check_project_limit (context-aware)

CREATE OR REPLACE FUNCTION public.check_project_limit(p_team_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
DECLARE
  v_plan TEXT;
  v_count INTEGER;
  v_limit INTEGER;
BEGIN
  v_plan := public.get_effective_plan(p_team_id);

  IF p_team_id IS NOT NULL THEN
    v_count := (
      SELECT COUNT(*) FROM user_projects
      WHERE team_id = p_team_id
    );
  ELSE
    v_count := (
      SELECT COUNT(*) FROM user_projects
      WHERE user_id = auth.uid() AND team_id IS NULL
    );
  END IF;

  v_limit := public.get_project_limit(v_plan);

  RETURN json_build_object(
    'allowed', v_count < v_limit,
    'current', v_count,
    'limit', v_limit,
    'plan', v_plan
  );
END;
$fn$;


-- 5. register_project (context-aware, added p_team_id param)

CREATE OR REPLACE FUNCTION public.register_project(
  p_path_hash text,
  p_project_name text,
  p_machine_id text,
  p_team_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
DECLARE
  v_plan TEXT;
  v_count INTEGER;
  v_limit INTEGER;
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  -- Check if this exact project already exists for this user
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
        removed_at = NULL,
        team_id = p_team_id
    WHERE id = v_existing_id;

    RETURN json_build_object(
      'success', true,
      'reactivated', true,
      'project_id', v_existing_id
    );
  END IF;

  -- New project: check limit in the relevant context
  v_plan := public.get_effective_plan(p_team_id);

  IF p_team_id IS NOT NULL THEN
    v_count := (
      SELECT COUNT(*) FROM user_projects WHERE team_id = p_team_id
    );
  ELSE
    v_count := (
      SELECT COUNT(*) FROM user_projects
      WHERE user_id = auth.uid() AND team_id IS NULL
    );
  END IF;

  v_limit := public.get_project_limit(v_plan);

  IF v_count >= v_limit THEN
    RETURN json_build_object(
      'success', false,
      'error', 'project_limit_reached',
      'current', v_count,
      'limit', v_limit,
      'plan', v_plan
    );
  END IF;

  INSERT INTO user_projects (user_id, path_hash, project_name, machine_id, team_id)
  VALUES (auth.uid(), p_path_hash, p_project_name, p_machine_id, p_team_id)
  RETURNING id INTO v_new_id;

  RETURN json_build_object(
    'success', true,
    'reactivated', false,
    'project_id', v_new_id
  );
END;
$fn$;


-- 6. get_templates_for_user (context-aware)

CREATE OR REPLACE FUNCTION public.get_templates_for_user(p_team_id uuid DEFAULT NULL)
RETURNS SETOF public.templates
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_plan TEXT;
BEGIN
  v_plan := public.get_effective_plan(p_team_id);

  RETURN QUERY
  SELECT *
  FROM templates
  WHERE is_active = TRUE
    AND (
      tier = 'basic'
      OR (tier = 'pro' AND v_plan IN ('pro', 'business', 'enterprise'))
      OR (tier = 'custom' AND v_plan = 'enterprise')
    )
  ORDER BY category, sort_order, name;
END;
$fn$;

ALTER FUNCTION public.get_templates_for_user(uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_templates_for_user(uuid) TO anon;
GRANT ALL ON FUNCTION public.get_templates_for_user(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_templates_for_user(uuid) TO service_role;


-- 7. Update accept_invitation: allow multiple teams
-- Only blocks joining the SAME team twice (not any team)

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_invitation RECORD;
  v_caller_id UUID;
  v_caller_email TEXT;
  v_caller_name TEXT;
  v_already_member UUID;
  v_team_name TEXT;
  v_owner_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  v_caller_email := (
    SELECT email FROM auth.users WHERE id = v_caller_id
  );

  v_caller_name := (
    SELECT COALESCE(display_name, v_caller_email)
    FROM profiles WHERE id = v_caller_id
  );

  -- Look up the invitation
  SELECT * INTO v_invitation
    FROM team_invitations
    WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'invitation_not_found');
  END IF;

  IF v_invitation.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'invitation_' || v_invitation.status);
  END IF;

  IF v_invitation.expires_at < NOW() THEN
    UPDATE team_invitations SET status = 'expired' WHERE id = v_invitation.id;
    RETURN json_build_object('success', false, 'error', 'invitation_expired');
  END IF;

  IF lower(v_invitation.email) != lower(v_caller_email) THEN
    RETURN json_build_object('success', false, 'error', 'email_mismatch');
  END IF;

  -- Check caller is not already on THIS specific team
  v_already_member := (
    SELECT team_id FROM team_members
    WHERE user_id = v_caller_id AND team_id = v_invitation.team_id
    LIMIT 1
  );

  IF v_already_member IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'already_on_this_team');
  END IF;

  -- Get team info
  SELECT name, owner_id INTO v_team_name, v_owner_id
    FROM teams WHERE id = v_invitation.team_id;

  -- All checks passed

  INSERT INTO team_members (team_id, user_id, role)
  VALUES (v_invitation.team_id, v_caller_id, 'member');

  UPDATE team_invitations
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_invitation.id;

  INSERT INTO team_activity_log (team_id, user_id, action)
  VALUES (v_invitation.team_id, v_caller_id, 'member_joined');

  INSERT INTO assistant_notifications (user_id, source, title, body, source_meta)
  VALUES (
    v_owner_id,
    'team',
    v_caller_name || ' joined your team',
    v_caller_name || ' accepted the invitation to ' || v_team_name,
    json_build_object('team_id', v_invitation.team_id)::jsonb
  );

  RETURN json_build_object(
    'success', true,
    'team_id', v_invitation.team_id,
    'team_name', v_team_name
  );
END;
$fn$;