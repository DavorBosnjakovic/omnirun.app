-- ============================================================
-- Migration: 008_waitlist_early_access.sql
-- Description: Add referral_source, invited_at, status to waitlist
--              for early-access invite wave management
-- ============================================================

-- Referral source — how they found Omnirun
alter table public.waitlist
  add column referral_source text;

-- When the early-access invite was sent (NULL = still waiting)
alter table public.waitlist
  add column invited_at timestamptz;

-- Funnel status: waiting → invited → converted
alter table public.waitlist
  add column status text not null default 'waiting'
  constraint waitlist_status_check check (status in ('waiting', 'invited', 'converted'));

-- Index for filtering by status (invite wave queries)
create index waitlist_status_idx on public.waitlist (status);

-- ============================================================
-- USEFUL QUERIES
-- ============================================================

-- Next batch to invite (oldest first, 20 at a time)
-- select id, email, created_at, referral_source
-- from public.waitlist
-- where status = 'waiting'
-- order by created_at asc
-- limit 20;

-- Mark a batch as invited
-- update public.waitlist
-- set status = 'invited', invited_at = now()
-- where id in ('...', '...');

-- Conversion rate
-- select status, count(*) from public.waitlist group by status;

-- Signups by referral source
-- select referral_source, count(*)
-- from public.waitlist
-- group by referral_source
-- order by count(*) desc;