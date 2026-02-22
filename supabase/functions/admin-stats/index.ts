import { getUser, supabaseAdmin, isAdmin } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Plan prices for MRR calculation
const MONTHLY_PRICES: Record<string, number> = {
  starter: 39,
  pro: 69,
  business: 199,
};
const YEARLY_MRR: Record<string, number> = {
  starter: 32.5, // $390 / 12
  pro: 57.5, // $690 / 12
  business: 165.83, // $1990 / 12
};

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  const user = await getUser(req);
  if (!user) {
    return errorResponse("Unauthorized", 401);
  }

  const admin = await isAdmin(user.id);
  if (!admin) {
    return errorResponse("Forbidden", 403);
  }

  try {
    // Run all queries in parallel
    const [
      totalUsers,
      activeSubscriptions,
      trialingUsers,
      canceledLast30,
      activeLast30,
      dauData,
      wauData,
      mauData,
      planDistribution,
      topProviders,
      topModels,
      geoDistribution,
      totalCost,
    ] = await Promise.all([
      // Total users
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true }),

      // Active + trialing subscriptions (for MRR)
      supabaseAdmin
        .from("subscriptions")
        .select("plan, billing_interval, status")
        .in("status", ["active", "trialing"]),

      // Users currently trialing
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "trialing"),

      // Canceled in last 30 days (for churn)
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "canceled")
        .gte("canceled_at", new Date(Date.now() - 30 * 86400000).toISOString()),

      // Were active 30 days ago (for churn denominator)
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "trialing", "canceled"])
        .lte(
          "created_at",
          new Date(Date.now() - 30 * 86400000).toISOString()
        ),

      // DAU — unique users with activity today
      supabaseAdmin
        .from("app_sessions")
        .select("user_id")
        .gte("started_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),

      // WAU — unique users with activity last 7 days
      supabaseAdmin
        .from("app_sessions")
        .select("user_id")
        .gte("started_at", new Date(Date.now() - 7 * 86400000).toISOString()),

      // MAU — unique users with activity last 30 days
      supabaseAdmin
        .from("app_sessions")
        .select("user_id")
        .gte("started_at", new Date(Date.now() - 30 * 86400000).toISOString()),

      // Plan distribution
      supabaseAdmin
        .from("subscriptions")
        .select("plan, status")
        .in("status", ["active", "trialing"]),

      // Top providers (RPC)
      supabaseAdmin.rpc("get_top_providers"),

      // Top models (RPC)
      supabaseAdmin.rpc("get_top_models"),

      // Geo distribution (RPC)
      supabaseAdmin.rpc("get_geo_distribution"),

      // Total estimated cost (RPC)
      supabaseAdmin.rpc("get_total_cost"),
    ]);

    // ── Calculate MRR ──────────────────────────────────────────
    let mrr = 0;
    if (activeSubscriptions.data) {
      for (const sub of activeSubscriptions.data) {
        if (sub.billing_interval === "monthly") {
          mrr += MONTHLY_PRICES[sub.plan] ?? 0;
        } else {
          mrr += YEARLY_MRR[sub.plan] ?? 0;
        }
      }
    }

    // ── Deduplicate active users ───────────────────────────────
    const uniqueUsers = (data: { user_id: string }[] | null) =>
      new Set(data?.map((r) => r.user_id) ?? []).size;

    const dau = uniqueUsers(dauData.data);
    const wau = uniqueUsers(wauData.data);
    const mau = uniqueUsers(mauData.data);

    // ── Churn rate ─────────────────────────────────────────────
    const canceledCount = canceledLast30.count ?? 0;
    const activeBase = activeLast30.count ?? 1; // avoid divide by zero
    const churnRate = activeBase > 0 ? (canceledCount / activeBase) * 100 : 0;

    // ── Trial conversion ───────────────────────────────────────
    const totalActive = activeSubscriptions.data?.filter(
      (s) => s.status === "active"
    ).length ?? 0;
    const totalTrialing = trialingUsers.count ?? 0;
    const totalConverted = totalActive; // active = converted from trial
    const trialConversion =
      totalActive + totalTrialing > 0
        ? (totalConverted / (totalActive + totalTrialing)) * 100
        : 0;

    // ── Plan distribution ──────────────────────────────────────
    const plans: Record<string, number> = {
      starter: 0,
      pro: 0,
      business: 0,
    };
    if (planDistribution.data) {
      for (const sub of planDistribution.data) {
        if (plans[sub.plan] !== undefined) {
          plans[sub.plan]++;
        }
      }
    }

    // ── Log admin access ───────────────────────────────────────
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "viewed_admin_stats",
      details: { timestamp: new Date().toISOString() },
    });

    return jsonResponse({
      total_users: totalUsers.count ?? 0,
      mrr: Math.round(mrr * 100) / 100,
      arr: Math.round(mrr * 12 * 100) / 100,
      churn_rate: Math.round(churnRate * 100) / 100,
      trial_conversion: Math.round(trialConversion * 100) / 100,
      dau,
      wau,
      mau,
      plan_distribution: plans,
      top_providers: topProviders.data ?? [],
      top_models: topModels.data ?? [],
      geo_distribution: geoDistribution.data ?? [],
      total_estimated_cost: totalCost.data ?? 0,
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    return errorResponse("Failed to fetch admin stats", 500);
  }
});