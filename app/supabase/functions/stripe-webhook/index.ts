import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// ─── Price ID → Plan mapping ─────────────────────────────────
const PRICE_TO_PLAN: Record<string, { plan: string; interval: string }> = {
  "price_1TJAtz2N9rEm3shKxAmAgVho": { plan: "starter",  interval: "monthly" },
  "price_1TJAvS2N9rEm3shKVcZZNBW8": { plan: "starter",  interval: "yearly" },
  "price_1TJAvq2N9rEm3shKfpcz3uBh": { plan: "pro",      interval: "monthly" },
  "price_1TJAwD2N9rEm3shKb7FVlKP6": { plan: "pro",      interval: "yearly" },
  "price_1TJAwe2N9rEm3shKT8hOZcJi": { plan: "studio",   interval: "monthly" },
  "price_1TJAwz2N9rEm3shKAJMBXgkf": { plan: "studio",   interval: "yearly" },
  "price_1TJAxL2N9rEm3shK2Biepabj": { plan: "team",     interval: "monthly" },
  "price_1TJAxd2N9rEm3shKNSXT2BdO": { plan: "team",     interval: "yearly" },
  "price_1TJAy42N9rEm3shKAtV4CmI3": { plan: "business",  interval: "monthly" },
  "price_1TJAyP2N9rEm3shKTsz1rKnV": { plan: "business",  interval: "yearly" },
};

function resolvePlan(priceId: string): { plan: string; interval: string } {
  return PRICE_TO_PLAN[priceId] ?? { plan: "starter", interval: "monthly" };
}

function toTimestamp(epoch: number | null | undefined): string | null {
  if (!epoch || typeof epoch !== "number") return null;
  return new Date(epoch * 1000).toISOString();
}

// ─── Stripe REST helpers ─────────────────────────────────────

async function stripeGet(endpoint: string) {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return await res.json();
}

// ─── Webhook signature verification (Web Crypto) ─────────────

async function verifySignature(body: string, signatureHeader: string): Promise<boolean> {
  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const sigPart = parts.find((p) => p.startsWith("v1="));

  if (!timestampPart || !sigPart) return false;

  const timestamp = timestampPart.slice(2);
  const expectedSig = sigPart.slice(3);

  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const signedPayload = `${timestamp}.${body}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedSig === expectedSig;
}

// ─── Main handler ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return errorResponse("Missing stripe-signature header", 400);
  }

  const valid = await verifySignature(body, signature);
  if (!valid) {
    console.error("Webhook signature verification failed");
    return errorResponse("Invalid signature", 400);
  }

  const event = JSON.parse(body);

  // Idempotency — skip already-processed events
  const { data: existing } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existing) {
    return jsonResponse({ received: true, status: "duplicate" });
  }

  // Log event for idempotency + debugging
  await supabaseAdmin.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event.data.object,
  });

  // Process
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    return jsonResponse({ received: true });
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err);
    return jsonResponse({ received: true, error: "processing_error" });
  }
});

// ─── Helpers ──────────────────────────────────────────────────

async function getUserIdByCustomer(stripeCustomerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (!data) {
    console.error(`No user found for Stripe customer: ${stripeCustomerId}`);
    return null;
  }
  return data.id;
}

// ─── Event Handlers ───────────────────────────────────────────

async function handleCheckoutCompleted(session: any) {
  const userId = session.metadata?.user_id;
  if (!userId) {
    console.error("checkout.session.completed missing user_id in metadata");
    return;
  }

  await supabaseAdmin
    .from("profiles")
    .update({ stripe_customer_id: session.customer })
    .eq("id", userId);

  console.log(`Checkout completed: user ${userId}, customer ${session.customer}`);
}

async function handleSubscriptionCreated(subscription: any) {
  const customerId = subscription.customer;
  const userId = await getUserIdByCustomer(customerId);
  if (!userId) return;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const { plan, interval } = resolvePlan(priceId);

  const { error } = await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      plan,
      billing_interval: interval,
      status: subscription.status,
      current_period_start: toTimestamp(subscription.current_period_start) ?? new Date().toISOString(),
      current_period_end: toTimestamp(subscription.current_period_end) ?? new Date().toISOString(),
      trial_start: toTimestamp(subscription.trial_start),
      trial_end: toTimestamp(subscription.trial_end),
      cancel_at: toTimestamp(subscription.cancel_at),
      canceled_at: toTimestamp(subscription.canceled_at),
      ended_at: null,
    },
    { onConflict: "stripe_subscription_id" }
  );

  if (error) {
    console.error("Failed to upsert subscription:", error.message);
    return;
  }

  console.log(`Subscription created: ${plan}/${interval} for user ${userId}`);
}

async function handleSubscriptionUpdated(subscription: any) {
  const customerId = subscription.customer;
  const userId = await getUserIdByCustomer(customerId);
  if (!userId) return;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const { plan, interval } = resolvePlan(priceId);

  await supabaseAdmin
    .from("subscriptions")
    .update({
      stripe_price_id: priceId,
      plan,
      billing_interval: interval,
      status: subscription.status,
      current_period_start: toTimestamp(subscription.current_period_start) ?? new Date().toISOString(),
      current_period_end: toTimestamp(subscription.current_period_end) ?? new Date().toISOString(),
      trial_start: toTimestamp(subscription.trial_start),
      trial_end: toTimestamp(subscription.trial_end),
      cancel_at: toTimestamp(subscription.cancel_at),
      canceled_at: toTimestamp(subscription.canceled_at),
    })
    .eq("user_id", userId);

  console.log(`Subscription updated: ${subscription.status} for user ${userId}`);
}

async function handleSubscriptionDeleted(subscription: any) {
  const customerId = subscription.customer;
  const userId = await getUserIdByCustomer(customerId);
  if (!userId) return;

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled",
      ended_at: new Date().toISOString(),
      canceled_at: toTimestamp(subscription.canceled_at) ?? new Date().toISOString(),
    })
    .eq("user_id", userId);

  console.log(`Subscription deleted for user ${userId}`);
}

async function handlePaymentSucceeded(invoice: any) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const subscription = await stripeGet(`/subscriptions/${subscriptionId}`);

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: subscription.status,
      current_period_start: toTimestamp(subscription.current_period_start) ?? new Date().toISOString(),
      current_period_end: toTimestamp(subscription.current_period_end) ?? new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  console.log(`Payment succeeded for subscription ${subscriptionId}`);
}

async function handlePaymentFailed(invoice: any) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("stripe_subscription_id", subscriptionId);

  console.log(`Payment failed for subscription ${subscriptionId}`);
}