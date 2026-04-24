-- ============================================================
-- Migration 006a: Add studio and team to plan_tier enum
-- ============================================================
-- Run this FIRST, then run 006b separately.
-- ============================================================

ALTER TYPE "public"."plan_tier" ADD VALUE IF NOT EXISTS 'studio' AFTER 'pro';
ALTER TYPE "public"."plan_tier" ADD VALUE IF NOT EXISTS 'team' AFTER 'studio';