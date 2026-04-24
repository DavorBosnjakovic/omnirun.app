// ============================================================
// Supabase Edge Function: send-invitation-email
// ============================================================
// Triggered two ways:
//   1. Database webhook on team_invitations INSERT (auto-send)
//   2. Direct invoke from teamStore.ts on resend
//
// Calls the Resend API to send a branded invitation email.
//
// Environment secrets (set via Supabase CLI):
//   RESEND_API_KEY        — Resend API key
//   SUPABASE_URL          — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided
//
// Deploy:
//   supabase functions deploy send-invitation-email --no-verify-jwt
//
// Webhook setup (Supabase Dashboard → Database → Webhooks):
//   Table: team_invitations
//   Events: INSERT
//   URL: https://<project>.supabase.co/functions/v1/send-invitation-email
//   Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FROM_EMAIL = "Omnirun <team@omnirun.app>";
const ACCEPT_BASE_URL = "https://omnirun.app/invite";
const DOWNLOAD_URL = "https://omnirun.app/download";

// ─── Email template ─────────────────────────────────────────

function buildEmailHtml(
  teamName: string,
  inviterName: string,
  token: string,
  expiresAt: string
): string {
  const acceptUrl = `${ACCEPT_BASE_URL}/${token}`;
  const expiryDate = new Date(expiresAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background:#2F3238; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#2F3238; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#383C43; background-image:url('https://omnirun.app/texture/email_bg.jpg'); background-size:cover; background-position:center; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0; text-align:center;">
              <img src="https://omnirun.app/logo/logo_transparent_dark_2x.png" alt="omnirun" width="160" style="display:inline-block; height:auto;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 32px;">
              <h1 style="margin:0 0 8px; font-size:24px; font-weight:600; color:#ffffff;">
                You've been invited to join ${teamName}
              </h1>
              <p style="margin:0 0 24px; font-size:16px; color:#9ca3af; line-height:1.6;">
                ${inviterName} invited you to collaborate on ${teamName} using Omnirun.
                One person works on a project at a time — no merge conflicts, no chaos.
              </p>

              <!-- CTA buttons -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:12px;">
                    <a href="${acceptUrl}"
                       style="display:block; background:#2DB87A; color:#ffffff; text-align:center;
                              padding:14px 24px; border-radius:8px; font-size:15px; font-weight:600;
                              text-decoration:none;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <a href="${DOWNLOAD_URL}"
                       style="display:block; background:#2F3238; color:#ffffff; text-align:center;
                              padding:12px 24px; border-radius:8px; font-size:14px; font-weight:500;
                              text-decoration:none;">
                      Download Omnirun
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0; font-size:12px; color:#6b7280; line-height:1.5;">
                This invitation expires on ${expiryDate}.
                If you didn't expect this, you can safely ignore it.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px; border-top:1px solid #555B63; text-align:center;">
              <img src="https://omnirun.app/logo/text_transparent_dark_2x.png" alt="omnirun" width="80" style="display:inline-block; height:auto; margin-bottom:6px;" />
              <p style="margin:0; font-size:11px; color:#6b7280;">
                Run everything. Describe it. <span style="color:#2DB87A;">Done.</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Handler ─────────────────────────────────────────────────

serve(async (req) => {
  try {
    const body = await req.json();

    // ── Determine the invitation ID ──
    // Webhook payload: { type: 'INSERT', record: { ... } }
    // Direct invoke:   { invitation_id: '...' }
    let invitationId: string;

    if (body.record?.id) {
      // Database webhook
      invitationId = body.record.id;
    } else if (body.invitation_id) {
      // Direct invoke (resend)
      invitationId = body.invitation_id;
    } else {
      return new Response(
        JSON.stringify({ error: "Missing invitation_id or webhook record" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Fetch invitation + team + inviter details ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: invitation, error: invErr } = await supabase
      .from("team_invitations")
      .select("id, team_id, invited_by, email, token, expires_at, status")
      .eq("id", invitationId)
      .single();

    if (invErr || !invitation) {
      return new Response(
        JSON.stringify({ error: "Invitation not found", detail: invErr?.message }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Only send for pending invitations
    if (invitation.status !== "pending") {
      return new Response(
        JSON.stringify({ skipped: true, reason: `Status is ${invitation.status}` }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get team name
    const { data: team } = await supabase
      .from("teams")
      .select("name")
      .eq("id", invitation.team_id)
      .single();

    const teamName = team?.name || "a team";

    // Get inviter's name
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("display_name, email")
      .eq("id", invitation.invited_by)
      .single();

    const inviterName =
      inviterProfile?.display_name || inviterProfile?.email || "Your teammate";

    // ── Send via Resend ──
    const emailHtml = buildEmailHtml(
      teamName,
      inviterName,
      invitation.token,
      invitation.expires_at
    );

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [invitation.email],
        subject: `You've been invited to join ${teamName} on Omnirun`,
        html: emailHtml,
      }),
    });

    const resendResult = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("[send-invitation-email] Resend error:", resendResult);
      return new Response(
        JSON.stringify({ error: "Failed to send email", detail: resendResult }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[send-invitation-email] Sent to ${invitation.email} for team "${teamName}" (Resend ID: ${resendResult.id})`
    );

    return new Response(
      JSON.stringify({ success: true, resend_id: resendResult.id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[send-invitation-email] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});