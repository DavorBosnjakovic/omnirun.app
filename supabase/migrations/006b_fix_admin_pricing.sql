-- ============================================================
-- Migration 006b: Fix admin view pricing
-- ============================================================
-- Run this AFTER 006a has been committed.
-- Preserves all original columns, only updates the pricing
-- CASE block and adds studio/team to MRR calculation.
-- ============================================================

-- Recreate admin_revenue_summary with correct pricing
CREATE OR REPLACE VIEW "public"."admin_revenue_summary" AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "public"."profiles") AS "total_users",
    ( SELECT "count"(*) AS "count"
           FROM "public"."profiles"
          WHERE ("profiles"."created_at" >= ("now"() - '30 days'::interval))) AS "signups_30d",
    ( SELECT "count"(*) AS "count"
           FROM "public"."profiles"
          WHERE ("profiles"."created_at" >= ("now"() - '7 days'::interval))) AS "signups_7d",
    ( SELECT "count"(*) AS "count"
           FROM "public"."subscriptions"
          WHERE ("subscriptions"."status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"]))) AS "active_subscriptions",
    ( SELECT "count"(*) AS "count"
           FROM "public"."subscriptions"
          WHERE (("subscriptions"."status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"])) AND ("subscriptions"."plan" = 'starter'::"public"."plan_tier"))) AS "starter_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."subscriptions"
          WHERE (("subscriptions"."status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"])) AND ("subscriptions"."plan" = 'pro'::"public"."plan_tier"))) AS "pro_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."subscriptions"
          WHERE (("subscriptions"."status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"])) AND ("subscriptions"."plan" = 'business'::"public"."plan_tier"))) AS "business_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."subscriptions"
          WHERE (("subscriptions"."status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"])) AND ("subscriptions"."plan" = 'enterprise'::"public"."plan_tier"))) AS "enterprise_count",
    ( SELECT COALESCE("sum"(
                CASE
                    WHEN (("subscriptions"."plan" = 'starter'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (10)::numeric
                    WHEN (("subscriptions"."plan" = 'starter'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 8.33
                    WHEN (("subscriptions"."plan" = 'pro'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (29)::numeric
                    WHEN (("subscriptions"."plan" = 'pro'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 24.17
                    WHEN (("subscriptions"."plan" = 'studio'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (59)::numeric
                    WHEN (("subscriptions"."plan" = 'studio'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 49.17
                    WHEN (("subscriptions"."plan" = 'team'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (99)::numeric
                    WHEN (("subscriptions"."plan" = 'team'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 82.50
                    WHEN (("subscriptions"."plan" = 'business'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (199)::numeric
                    WHEN (("subscriptions"."plan" = 'business'::"public"."plan_tier") AND ("subscriptions"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 165.83
                    ELSE (0)::numeric
                END), (0)::numeric) AS "coalesce"
           FROM "public"."subscriptions"
          WHERE ("subscriptions"."status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"]))) AS "mrr",
    ( SELECT "count"(*) AS "count"
           FROM "public"."profiles"
          WHERE ("profiles"."subscription_status" = 'trialing'::"public"."subscription_status")) AS "active_trials",
    ( SELECT "count"(*) AS "count"
           FROM "public"."profiles"
          WHERE (("profiles"."subscription_status" = 'incomplete'::"public"."subscription_status") AND ("profiles"."trial_ends_at" < "now"()))) AS "expired_trials",
    ( SELECT "count"(*) AS "count"
           FROM "public"."subscriptions"
          WHERE (("subscriptions"."status" = 'canceled'::"public"."subscription_status") AND ("subscriptions"."canceled_at" >= ("now"() - '30 days'::interval)))) AS "churned_30d",
    ( SELECT "count"(DISTINCT "app_sessions"."user_id") AS "count"
           FROM "public"."app_sessions"
          WHERE ("app_sessions"."started_at" >= ("now"() - '1 day'::interval))) AS "dau",
    ( SELECT "count"(DISTINCT "app_sessions"."user_id") AS "count"
           FROM "public"."app_sessions"
          WHERE ("app_sessions"."started_at" >= ("now"() - '7 days'::interval))) AS "wau",
    ( SELECT "count"(DISTINCT "app_sessions"."user_id") AS "count"
           FROM "public"."app_sessions"
          WHERE ("app_sessions"."started_at" >= ("now"() - '30 days'::interval))) AS "mau";


-- Recreate admin_revenue_at_risk with correct pricing
CREATE OR REPLACE VIEW "public"."admin_revenue_at_risk" AS
 SELECT "p"."id" AS "user_id",
    "p"."email",
    "p"."display_name",
    "p"."plan",
    "p"."subscription_status",
    "sub"."billing_interval",
    "sub"."current_period_end",
    "p"."last_active_at",
    (EXTRACT(day FROM ("now"() - "p"."last_active_at")))::integer AS "days_inactive",
    "p"."total_sessions",
    "p"."country",
    "p"."os",
        CASE
            WHEN (("p"."plan" = 'starter'::"public"."plan_tier") AND ("sub"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (10)::numeric
            WHEN (("p"."plan" = 'starter'::"public"."plan_tier") AND ("sub"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 8.33
            WHEN (("p"."plan" = 'pro'::"public"."plan_tier") AND ("sub"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (29)::numeric
            WHEN (("p"."plan" = 'pro'::"public"."plan_tier") AND ("sub"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 24.17
            WHEN (("p"."plan" = 'studio'::"public"."plan_tier") AND ("sub"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (59)::numeric
            WHEN (("p"."plan" = 'studio'::"public"."plan_tier") AND ("sub"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 49.17
            WHEN (("p"."plan" = 'team'::"public"."plan_tier") AND ("sub"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (99)::numeric
            WHEN (("p"."plan" = 'team'::"public"."plan_tier") AND ("sub"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 82.50
            WHEN (("p"."plan" = 'business'::"public"."plan_tier") AND ("sub"."billing_interval" = 'monthly'::"public"."billing_interval")) THEN (199)::numeric
            WHEN (("p"."plan" = 'business'::"public"."plan_tier") AND ("sub"."billing_interval" = 'yearly'::"public"."billing_interval")) THEN 165.83
            ELSE (0)::numeric
        END AS "monthly_revenue_at_risk"
   FROM ("public"."profiles" "p"
     JOIN "public"."subscriptions" "sub" ON ((("sub"."user_id" = "p"."id") AND ("sub"."status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"])))))
  WHERE (("p"."last_active_at" < ("now"() - '14 days'::interval)) AND ("p"."subscription_status" = ANY (ARRAY['active'::"public"."subscription_status", 'trialing'::"public"."subscription_status"])));