# Omnirun Admin

Internal admin desktop app for the Omnirun platform. Separate from the main user-facing app. Only accessible to users with `is_admin = true` in the `profiles` table.

## What it shows

- **Overview** — headline metrics (users, signups, MRR, active subs)
- **Users** — every profile, searchable + filterable, with ban/admin/plan/trial/notes actions
- **Teams** — all teams, members, invitations, activity
- **Subscriptions** — all Stripe subscriptions, at-risk, trial conversions
- **Usage & Costs** — token/cost firehose across all users
- **Engagement** — sessions, feature adoption, power users, cohort retention
- **Projects** — all user projects across the fleet
- **Templates** — marketplace templates, downloads, kill switch
- **Waitlist** — signups, batch invite
- **Integrations** — assistant email/calendar connections
- **Devices & Sync** — desktop devices, mobile pairings, synced data
- **Audit Log** — every admin action

## Tech stack

- Tauri 2 (Rust + React + TypeScript)
- Vite + Tailwind CSS v3
- Zustand (state)
- Supabase JS (auth + data, RLS-gated to admins)
- Recharts (charts)
- Lucide (icons)

## Dev

```bash
npm install
npm run tauri dev
```