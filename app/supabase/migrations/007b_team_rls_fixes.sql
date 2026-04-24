-- 007b: Team RLS fixes discovered during testing

-- Fix: Invitees see own invitations (was querying auth.users, now uses auth.email())
DROP POLICY IF EXISTS "Invitees see own invitations" ON team_invitations;
CREATE POLICY "Invitees see own invitations"
ON team_invitations FOR SELECT
USING (email = auth.email());

-- Fix: Invitees can read the team they're invited to
CREATE POLICY "Invitees read invited team"
ON teams FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_invitations
    WHERE team_invitations.team_id = teams.id
    AND lower(team_invitations.email) = lower(auth.email())
    AND team_invitations.status = 'pending'
  )
);

-- Fix: Invitees can decline their own invitations
CREATE POLICY "Invitees decline own invitations"
ON team_invitations FOR UPDATE
USING (email = auth.email())
WITH CHECK (email = auth.email());