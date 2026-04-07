import { getUser, supabaseAdmin } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

// ─── Price ID mapping ─────────────────────────────────────────
const PRICE_IDS: Record<string, string> = {
  starter_monthly:  "price_1TJAtz2N9rEm3shKxAmAgVho",
  starter_yearly:   "price_1TJAvS2N9rEm3shKVcZZNBW8",
  pro_monthly:      "price_1TJAvq2N9rEm3shKfpcz3uBh",
  pro_yearly:       "price_1TJAwD2N9rEm3shKb7FVlKP6",
  studio_monthly:   "price_1TJAwe2N9rEm3shKT8hOZcJi",
  studio_yearly:    "price_1TJAwz2N9rEm3shKAJMBXgkf",
  team_monthly:     "price_1TJAxL2N9rEm3shK2Biepabj",
  team_yearly:      "price_1TJAxd2N9rEm3shKNSXT2BdO",
  business_monthly: "price_1TJAy42N9rEm3shKAtV4CmI3",
  business_yearly:  "price_1TJAyP2N9rEm3shKTsz1rKnV",
};

// ─── Stripe REST helper ──────────────────────────────────────
async function stripePost(endpoint: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Stripe API error");
  return data;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const user = await getUser(req);
  if (!user) {
    return errorResponse("Not authenticated", 401);
  }

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
      const customer = await stripePost("/customers", {
        email: profile?.email ?? user.email ?? "",
        "metadata[user_id]": user.id,
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

    // Static pages hosted in Supabase Storage (public bucket: static)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const successUrl = "https://omnirun.app/checkout/success";
    const cancelUrl = "https://omnirun.app/checkout/cancel";

    // Create Checkout Session
    const session = await stripePost("/checkout/sessions", {
      customer: customerId!,
      mode: "subscription",
      payment_method_collection: "always",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "7",
      "subscription_data[metadata][user_id]": user.id,
      "metadata[user_id]": user.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: "true",
    });

    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    return errorResponse("Failed to create checkout session", 500);
  }
});