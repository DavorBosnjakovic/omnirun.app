import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { getUser, supabaseAdmin } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

// ─── Price ID mapping ─────────────────────────────────────────
// REPLACE these values with your real Stripe price_xxx IDs
const PRICE_IDS: Record<string, string> = {
  starter_monthly:  "price_starter_monthly",
  starter_yearly:   "price_starter_yearly",
  pro_monthly:      "price_pro_monthly",
  pro_yearly:       "price_pro_yearly",
  business_monthly: "price_business_monthly",
  business_yearly:  "price_business_yearly",
};

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Authenticate
  const user = await getUser(req);
  if (!user) {
    return errorResponse("Unauthorized", 401);
  }

  // Parse request body
  const { plan, interval } = await req.json();
  if (!plan || !interval) {
    return errorResponse("Missing plan or interval");
  }

  const priceKey = `${plan}_${interval}`;
  const priceId = PRICE_IDS[priceKey];
  if (!priceId) {
    return errorResponse(`Invalid plan/interval: ${priceKey}`);
  }

  try {
    // Get or create Stripe customer
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email ?? user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;

      await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Block if already subscribed
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (existingSub) {
      return errorResponse(
        "You already have an active subscription. Use the customer portal to change plans.",
        409
      );
    }

    // Create Checkout Session with 7-day trial
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_collection: "always",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { user_id: user.id },
      },
      metadata: { user_id: user.id },
      success_url: `${
        Deno.env.get("APP_URL") ?? "mydevify://"
      }subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${
        Deno.env.get("APP_URL") ?? "mydevify://"
      }subscription/cancel`,
      allow_promotion_codes: true,
    });

    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    return errorResponse("Failed to create checkout session", 500);
  }
});