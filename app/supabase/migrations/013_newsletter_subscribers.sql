-- ============================================================
-- Migration: 013_newsletter_subscribers.sql
-- Description: Newsletter subscribers table
-- ============================================================

create table public.newsletter_subscribers (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  source     text        not null default 'website',
  created_at timestamptz not null default now()
);

create index newsletter_email_idx on public.newsletter_subscribers (email);

alter table public.newsletter_subscribers enable row level security;

-- Anyone can insert (no auth required)
create policy "Anyone can subscribe"
  on public.newsletter_subscribers
  for insert
  to anon, authenticated
  with check (true);

-- No public reads
create policy "No public reads"
  on public.newsletter_subscribers
  for select
  to anon, authenticated
  using (false);