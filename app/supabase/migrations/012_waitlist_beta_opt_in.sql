-- ============================================================
-- Migration: 009_waitlist_beta_opt_in.sql
-- Description: Add beta_opt_in column to waitlist table
-- ============================================================

alter table public.waitlist add column beta_opt_in boolean not null default false;