-- ============================================================
-- Migration: 20260329133518_create_waitlist.sql
-- Replaces: waitlist_table.sql + waitlist_simplify.sql
-- Description: Create waitlist table — email only
-- ============================================================

-- Drop existing table and all its constraints/indexes cleanly
drop table if exists public.waitlist cascade;

-- Create clean waitlist table
create table public.waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  created_at timestamptz not null default now()
);

-- Index for email lookups
create index waitlist_email_idx on public.waitlist (email);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.waitlist enable row level security;

-- Anyone can insert (no auth required to join waitlist)
create policy "Anyone can join waitlist"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);

-- No public reads — admin/service role only
create policy "No public reads"
  on public.waitlist
  for select
  to anon, authenticated
  using (false);

-- Admins can read everything (policies are OR'd, so this grants
-- access without loosening the public block above)
create policy "Admins read all waitlist"
  on public.waitlist
  for select
  to authenticated
  using (public.is_admin());

-- ============================================================
-- USEFUL QUERIES
-- ============================================================

-- Total signups
-- select count(*) from public.waitlist;

-- Signups by day
-- select date_trunc('day', created_at) as day, count(*)
-- from public.waitlist
-- group by day
-- order by day;