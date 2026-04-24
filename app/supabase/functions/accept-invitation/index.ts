import { getUser, supabaseAdmin } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const user = await getUser(req);
  if (!user) {
    return errorResponse("Unauthorized", 401);
  }

  const { token } = await req.json();
  if (!token) {
    return errorResponse("Missing invitation token");
  }

  try {
    // ── 1. Validate invitation ──────────────────────────────────

    const { data: invitation, error: invError } = await supabaseAdmin
      .from("team_invitations")
      .select("id, team_id, email, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (invError || !invitation) {
      return errorResponse("Invalid invitation token", 404);
    }

    if (invitation.status !== "pending") {
      return errorResponse(
        `Invitation has already been ${invitation.status}`,
        410
      );
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await supabaseAdmin
        .from("team_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      return errorResponse("Invitation has expired", 410);
    }

    // Check email matches (case-insensitive)
    if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
      return errorResponse(
        "This invitation was sent to a different email address",
        403
      );
    }

    // ── 2. Check user isn't already in a team ───────────────────

    const { data: existingMembership } = await supabaseAdmin
      .from("team_members")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingMembership) {
      return errorResponse(
        "You are already a member of a team. Leave your current team first.",
        409
      );
    }

    // ── 3. Check seat limit ─────────────────────────────────────

    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id, name, max_seats")
      .eq("id", invitation.team_id)
      .single();

    if (!team) {
      return errorResponse("Team no longer exists", 404);
    }

    const { count: currentMembers } = await supabaseAdmin
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id);

    if (currentMembers !== null && currentMembers >= team.max_seats) {
      return errorResponse(
        `Team is full (${currentMembers}/${team.max_seats} seats used)`,
        409
      );
    }

    // ── 4. Add user to team ─────────────────────────────────────

    const { error: memberError } = await supabaseAdmin
      .from("team_members")
      .insert({
        team_id: team.id,
        user_id: user.id,
        role: "member",
      });

    if (memberError) {
      console.error("Failed to add team member:", memberError);
      return errorResponse("Failed to join team", 500);
    }

    // ── 5. Mark invitation accepted ─────────────────────────────

    await supabaseAdmin
      .from("team_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);

    // ── 6. Log activity ─────────────────────────────────────────

    await supabaseAdmin.from("team_activity_log").insert({
      team_id: team.id,
      user_id: user.id,
      action: "member_joined",
      metadata: {
        email: user.email,
        display_name: user.user_metadata?.display_name ?? user.email,
        invitation_id: invitation.id,
      },
    });

    return jsonResponse({
      success: true,
      team: { id: team.id, name: team.name },
      message: `You have joined ${team.name}!`,
    });
  } catch (err) {
    console.error("Error accepting invitation:", err);
    return errorResponse("Failed to accept invitation", 500);
  }
});