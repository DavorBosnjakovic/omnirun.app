-- ============================================================
-- Migration 007: Team Notifications, Accept Invitation, Lock Cleanup
-- ============================================================
-- 1. notify_project_available() — trigger on project_locks DELETE
--    Inserts a notification for every team member (except the lock holder)
--    when a project unlocks (manual, idle timeout, crash recovery, force-unlock).
--
-- 2. accept_invitation(p_token) — RPC for accepting team invitations
--    Validates token, checks constraints, inserts team_member, updates invitation,
--    logs activity, and notifies the team owner.
--
-- 3. notify_invitation_created() — trigger on team_invitations INSERT
--    If the invitee already has an account, creates an in-app notification.
--
-- 4. Service-role INSERT policy on assistant_notifications
--    Allows triggers (SECURITY DEFINER functions) to write notifications.
--
-- 5. pg_cron job for stale lock cleanup (every minute)
-- ============================================================


-- ─── 1. Project Available Notification (on unlock) ─────────

CREATE OR REPLACE FUNCTION public.notify_project_available()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  locker_name TEXT;
BEGIN
  -- Get the display name of whoever held the lock
  SELECT COALESCE(display_name, email, 'A teammate')
    INTO locker_name
    FROM profiles
    WHERE id = OLD.locked_by;

  -- Notify every other team member
  INSERT INTO assistant_notifications (user_id, source, title, body, source_meta)
  SELECT
    tm.user_id,
    'team',
    OLD.project_name || ' is now available',
    locker_name || ' finished working on ' || OLD.project_name,
    jsonb_build_object(
      'type', 'project_available',
      'project_name', OLD.project_name,
      'team_id', OLD.team_id::text,
      'unlocked_by', OLD.locked_by::text
    )
  FROM team_members tm
  WHERE tm.team_id = OLD.team_id
    AND tm.user_id != OLD.locked_by;

  RETURN OLD;
END;
$$;

-- Drop if exists (idempotent)
DROP TRIGGER IF EXISTS on_project_unlock ON public.project_locks;

CREATE TRIGGER on_project_unlock
  AFTER DELETE ON public.project_locks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_project_available();


-- ─── 2. Accept Invitation RPC ──────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
  v_caller_id UUID;
  v_caller_email TEXT;
  v_caller_name TEXT;
  v_existing_team UUID;
  v_team_name TEXT;
  v_owner_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Get the caller's email
  SELECT email INTO v_caller_email
    FROM auth.users
    WHERE id = v_caller_id;

  -- Get caller display name
  SELECT COALESCE(display_name, v_caller_email) INTO v_caller_name
    FROM profiles
    WHERE id = v_caller_id;

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
    -- Auto-expire it
    UPDATE team_invitations SET status = 'expired' WHERE id = v_invitation.id;
    RETURN json_build_object('success', false, 'error', 'invitation_expired');
  END IF;

  -- Verify the email matches
  IF lower(v_invitation.email) != lower(v_caller_email) THEN
    RETURN json_build_object('success', false, 'error', 'email_mismatch');
  END IF;

  -- Check caller isn't already on a team
  SELECT team_id INTO v_existing_team
    FROM team_members
    WHERE user_id = v_caller_id
    LIMIT 1;

  IF v_existing_team IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'already_on_team');
  END IF;

  -- Get team info
  SELECT name, owner_id INTO v_team_name, v_owner_id
    FROM teams
    WHERE id = v_invitation.team_id;

  -- ── All checks passed — execute ──

  -- 1. Add to team
  INSERT INTO team_members (team_id, user_id, role)
  VALUES (v_invitation.team_id, v_caller_id, 'member');

  -- 2. Mark invitation accepted
  UPDATE team_invitations
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_invitation.id;

  -- 3. Log activity
  INSERT INTO team_activity_log (team_id, user_id, action)
  VALUES (v_invitation.team_id, v_caller_id, 'member_joined');

  -- 4. Notify the team owner
  INSERT INTO assistant_notifications (user_id, source, title, body, source_meta)
  VALUES (
    v_owner_id,
    'team',
    v_caller_name || ' joined your team',
    v_caller_name || ' accepted the invitation and joined ' || v_team_name || '.',
    jsonb_build_object(
      'type', 'member_joined',
      'team_id', v_invitation.team_id::text,
      'member_id', v_caller_id::text
    )
  );

  RETURN json_build_object(
    'success', true,
    'team_id', v_invitation.team_id,
    'team_name', v_team_name
  );
END;
$$;


-- ─── 3. Invitation Created Notification ─────────────────────
-- If the invitee already has an account, give them an in-app notification.

CREATE OR REPLACE FUNCTION public.notify_invitation_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitee_id UUID;
  v_team_name TEXT;
BEGIN
  -- Check if the invitee already has an account
  SELECT id INTO v_invitee_id
    FROM auth.users
    WHERE lower(email) = lower(NEW.email);

  IF v_invitee_id IS NOT NULL THEN
    -- Get team name
    SELECT name INTO v_team_name
      FROM teams
      WHERE id = NEW.team_id;

    INSERT INTO assistant_notifications (user_id, source, title, body, source_meta)
    VALUES (
      v_invitee_id,
      'team',
      'You''ve been invited to join ' || v_team_name,
      'Open Settings → Team to accept the invitation.',
      jsonb_build_object(
        'type', 'invitation_received',
        'team_id', NEW.team_id::text,
        'invitation_id', NEW.id::text,
        'token', NEW.token
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_invitation_created ON public.team_invitations;

CREATE TRIGGER on_invitation_created
  AFTER INSERT ON public.team_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_invitation_created();


-- ─── 4. Service-role INSERT policy on notifications ─────────
-- SECURITY DEFINER functions run as postgres, which bypasses RLS.
-- But just in case any future code uses service_role client:

CREATE POLICY "Service role inserts notifications"
  ON public.assistant_notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);


-- ─── 5. pg_cron: clean stale locks every minute ────────────
-- cleanup_stale_locks() already exists in the schema.
-- This schedules it. Run once — idempotent via cron.unschedule.

DO $$
BEGIN
  -- Remove if already scheduled (idempotent)
  PERFORM cron.unschedule('cleanup-stale-locks');
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available — skip scheduling. Enable the pg_cron extension in Supabase dashboard.';
  WHEN OTHERS THEN
    NULL; -- Job didn't exist, that's fine
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-stale-locks',
    '* * * * *',
    'SELECT public.cleanup_stale_locks()'
  );
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available — stale lock cleanup must be triggered externally.';
END;
$$;