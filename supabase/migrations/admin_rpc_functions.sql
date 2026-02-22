-- ============================================================
-- Admin RPC Functions for admin-stats Edge Function
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Top AI providers by usage count (last 30 days)
CREATE OR REPLACE FUNCTION get_top_providers()
RETURNS TABLE (provider text, usage_count bigint, total_tokens bigint, total_cost numeric)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    provider,
    COUNT(*) AS usage_count,
    COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
    COALESCE(SUM(estimated_cost), 0) AS total_cost
  FROM usage_events
  WHERE occurred_at >= NOW() - INTERVAL '30 days'
  GROUP BY provider
  ORDER BY usage_count DESC
  LIMIT 10;
$$;

-- 2. Top AI models by usage count (last 30 days)
CREATE OR REPLACE FUNCTION get_top_models()
RETURNS TABLE (model text, provider text, usage_count bigint, total_tokens bigint, total_cost numeric)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    model,
    provider,
    COUNT(*) AS usage_count,
    COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
    COALESCE(SUM(estimated_cost), 0) AS total_cost
  FROM usage_events
  WHERE occurred_at >= NOW() - INTERVAL '30 days'
  GROUP BY model, provider
  ORDER BY usage_count DESC
  LIMIT 10;
$$;

-- 3. User distribution by country
CREATE OR REPLACE FUNCTION get_geo_distribution()
RETURNS TABLE (country text, user_count bigint)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    COALESCE(country, 'Unknown') AS country,
    COUNT(*) AS user_count
  FROM profiles
  WHERE country IS NOT NULL
  GROUP BY country
  ORDER BY user_count DESC
  LIMIT 20;
$$;

-- 4. Total estimated AI cost across all users (last 30 days)
CREATE OR REPLACE FUNCTION get_total_cost()
RETURNS numeric
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT COALESCE(SUM(estimated_cost), 0)
  FROM usage_events
  WHERE occurred_at >= NOW() - INTERVAL '30 days';
$$;
```

That's all 9 files done. To recap, your full structure:
```
supabase/
├── functions/
│   ├── _shared/
│   │   ├── supabase.ts          ← #1
│   │   └── cors.ts              ← #2
│   ├── stripe-webhook/
│   │   └── index.ts             ← #3
│   ├── stripe-create-checkout/
│   │   └── index.ts             ← #4
│   ├── stripe-create-portal/
│   │   └── index.ts             ← #5
│   ├── accept-invitation/
│   │   └── index.ts             ← #6
│   ├── wake-on-lan/
│   │   └── index.ts             ← #7
│   └── admin-stats/
│       └── index.ts             ← #8
└── migrations/
    └── admin_rpc_functions.sql   ← #9