import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Service role client — bypasses RLS. Used by stripe-webhook and admin-stats.
export const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Create a client scoped to the requesting user's JWT
export function supabaseClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
}

// Extract authenticated user from request.
// Uses the service-role admin client to validate the JWT directly.
// This avoids "Auth session missing" errors that happen when a
// user-scoped client has no active session in the Edge Runtime.
export async function getUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.log("[getUser] No Authorization header");
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error) {
    console.log("[getUser] Error:", error.message);
    return null;
  }
  if (!user) {
    console.log("[getUser] No user returned");
    return null;
  }
  return user;
}

// Check if user is admin
export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();
  return data?.is_admin === true;
}