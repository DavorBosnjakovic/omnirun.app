import { getUser, supabaseAdmin } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

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

  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return errorResponse(
        "No billing account found. Please subscribe first.",
        404
      );
    }

    const appUrl = Deno.env.get("APP_URL") ?? "omnirun://";

    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: profile.stripe_customer_id,
        return_url: `${appUrl}settings/subscription`,
      }).toString(),
    });

    const session = await res.json();

    if (!res.ok) {
      throw new Error(session.error?.message || "Stripe API error");
    }

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("Error creating portal session:", err);
    return errorResponse("Failed to create portal session", 500);
  }
});