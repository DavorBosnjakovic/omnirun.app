import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { getUser, supabaseAdmin } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

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

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${
        Deno.env.get("APP_URL") ?? "mydevify://"
      }settings/subscription`,
    });

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("Error creating portal session:", err);
    return errorResponse("Failed to create portal session", 500);
  }
});