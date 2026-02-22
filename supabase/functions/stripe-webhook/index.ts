import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// ─── Price ID → Plan mapping ─────────────────────────────────
// REPLACE these placeholder keys with your real Stripe price_xxx IDs
// after creating products in the Stripe dashboard.
const PRICE_TO_PLAN: Record<string, { plan: string; interval: string }> = {
  "price_starter_monthly":  { plan: "starter",  interval: "monthly" },
  "price_starter_yearly":   { plan: "starter",  interval: "yearly" },
  "price_pro_monthly":      { plan: "pro",      interval: "monthly" },
  "price_pro_yearly":       { plan: "pro",      interval: "yearly" },
  "price_business_monthly": { plan: "business",  interval: "monthly" },
  "price_business_yearly":  { plan: "business",  interval: "yearly" },
};

function resolvePlan(priceId: string): { plan: string; interval: string } {
  return PRICE_TO_PLAN[priceId] ?? { plan: "starter", interval: "monthly" };
}

function toTimestamp(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

// ─── Main handler ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Verify Stripe signature
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return errorResponse("Missing stripe-signature header", 400);
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return errorResponse("Invalid signature", 400);
  }

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
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session
        );
        break;
      case "customer.subscription.created":
        await handleSubscriptionCreated(
          event.data.object as Stripe.Subscription
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription
        );
        break;
      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    return jsonResponse({ received: true });
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err);
    // Return 200 to prevent Stripe retries — event is logged, we can investigate
    return jsonResponse({ received: true, error: "processing_error" });
  }
});

// ─── Helpers ──────────────────────────────────────────────────

async function getUserIdByCustomer(
  stripeCustomerId: string
): Promise<string | null> {
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

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id;
  if (!userId) {
    console.error("checkout.session.completed missing user_id in metadata");
    return;
  }

  // Link Stripe customer to profile
  await supabaseAdmin
    .from("profiles")
    .update({ stripe_customer_id: session.customer as string })
    .eq("id", userId);

  console.log(
    `Checkout completed: user ${userId}, customer ${session.customer}`
  );
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const userId = await getUserIdByCustomer(customerId);
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id;
  const { plan, interval } = resolvePlan(priceId);

  // Upsert — one subscription per user
  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      plan,
      billing_interval: interval,
      status: subscription.status,
      current_period_start: toTimestamp(subscription.current_period_start),
      current_period_end: toTimestamp(subscription.current_period_end),
      trial_start: subscription.trial_start
        ? toTimestamp(subscription.trial_start)
        : null,
      trial_end: subscription.trial_end
        ? toTimestamp(subscription.trial_end)
        : null,
      cancel_at: subscription.cancel_at
        ? toTimestamp(subscription.cancel_at)
        : null,
      canceled_at: subscription.canceled_at
        ? toTimestamp(subscription.canceled_at)
        : null,
      ended_at: null,
    },
    { onConflict: "user_id" }
  );

  console.log(`Subscription created: ${plan}/${interval} for user ${userId}`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const userId = await getUserIdByCustomer(customerId);
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id;
  const { plan, interval } = resolvePlan(priceId);

  await supabaseAdmin
    .from("subscriptions")
    .update({
      stripe_price_id: priceId,
      plan,
      billing_interval: interval,
      status: subscription.status,
      current_period_start: toTimestamp(subscription.current_period_start),
      current_period_end: toTimestamp(subscription.current_period_end),
      trial_start: subscription.trial_start
        ? toTimestamp(subscription.trial_start)
        : null,
      trial_end: subscription.trial_end
        ? toTimestamp(subscription.trial_end)
        : null,
      cancel_at: subscription.cancel_at
        ? toTimestamp(subscription.cancel_at)
        : null,
      canceled_at: subscription.canceled_at
        ? toTimestamp(subscription.canceled_at)
        : null,
    })
    .eq("user_id", userId);

  console.log(
    `Subscription updated: ${subscription.status} for user ${userId}`
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const userId = await getUserIdByCustomer(customerId);
  if (!userId) return;

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled",
      ended_at: new Date().toISOString(),
      canceled_at: subscription.canceled_at
        ? toTimestamp(subscription.canceled_at)
        : new Date().toISOString(),
    })
    .eq("user_id", userId);

  console.log(`Subscription deleted for user ${userId}`);
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  // Fetch latest period dates from Stripe
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: subscription.status,
      current_period_start: toTimestamp(subscription.current_period_start),
      current_period_end: toTimestamp(subscription.current_period_end),
    })
    .eq("stripe_subscription_id", subscriptionId);

  console.log(`Payment succeeded for subscription ${subscriptionId}`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("stripe_subscription_id", subscriptionId);

  console.log(`Payment failed for subscription ${subscriptionId}`);
}