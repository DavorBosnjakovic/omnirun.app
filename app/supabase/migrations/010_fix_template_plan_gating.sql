-- ============================================================
-- Migration 010: Fix template plan gating
-- Date: 2026-04-11
-- Description: Update get_templates_for_plan() to include all
--   plan tiers. Studio/Team/Business/Enterprise all get pro templates.
--   Enterprise gets custom templates.
-- ============================================================
-- Plan hierarchy:
--   starter     → basic templates only
--   pro         → basic + pro templates
--   studio      → basic + pro templates
--   team        → basic + pro templates
--   business    → basic + pro templates
--   enterprise  → basic + pro + custom templates
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_templates_for_plan(user_plan text)
RETURNS SETOF public.templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM templates
  WHERE is_active = TRUE
    AND (
      tier = 'basic'
      OR (tier = 'pro' AND user_plan IN ('pro', 'studio', 'team', 'business', 'enterprise'))
      OR (tier = 'custom' AND user_plan = 'enterprise')
    )
  ORDER BY category, sort_order, name;
END;
$$;