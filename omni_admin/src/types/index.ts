// ============================================================
// Enums (mirror Supabase enum types)
// ============================================================

export type PlanTier = "starter" | "pro" | "studio" | "team" | "business" | "enterprise";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused"
  | "incomplete"
  | "incomplete_expired";

export type BillingInterval = "monthly" | "yearly";

export type TeamRole = "owner" | "member";

export type ApiKeyPolicy = "shared" | "individual";

export type InvitationStatus = "pending" | "accepted" | "expired" | "canceled";

export type ActivityAction =
  | "project_created"
  | "project_deleted"
  | "project_opened"
  | "deployed"
  | "deploy_failed"
  | "member_joined"
  | "member_removed"
  | "member_invited"
  | "team_created"
  | "team_settings_changed"
  | "task_created"
  | "task_run"
  | "task_failed";

// ============================================================
// Profile
// ============================================================

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  plan: PlanTier;
  subscription_status: SubscriptionStatus;
  stripe_customer_id: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  is_admin: boolean;
  is_banned: boolean;
  admin_notes: string | null;
  auth_provider: string | null;
  signup_source: string | null;
  app_version: string | null;
  os: string | null;
  country: string | null;
  timezone: string | null;
  last_active_at: string | null;
  total_sessions: number;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Admin Views
// ============================================================

export interface AdminUserOverview {
  user_id: string;
  email: string;
  display_name: string | null;
  plan: PlanTier;
  subscription_status: SubscriptionStatus;
  auth_provider: string | null;
  signup_source: string | null;
  app_version: string | null;
  os: string | null;
  country: string | null;
  timezone: string | null;
  is_banned: boolean;
  is_admin: boolean;
  admin_notes: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  last_active_at: string | null;
  total_sessions: number;
  signed_up_at: string;
  billing_interval: BillingInterval | null;
  current_period_end: string | null;
  cancel_at: string | null;
  providers_used: string[] | null;
  models_used: string[] | null;
  top_provider: string | null;
  top_model: string | null;
  lifetime_tokens: number;
  lifetime_cost: number;
  lifetime_api_calls: number;
  tokens_30d: number;
  cost_30d: number;
  project_count: number;
  team_name: string | null;
  team_role: TeamRole | null;
}

export interface AdminRevenueSummary {
  total_users: number;
  signups_30d: number;
  signups_7d: number;
  active_subscriptions: number;
  starter_count: number;
  pro_count: number;
  business_count: number;
  enterprise_count: number;
  mrr: number;
}

export interface AdminRevenueAtRisk {
  user_id: string;
  email: string;
  display_name: string | null;
  plan: PlanTier;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  current_period_end: string;
  cancel_at: string | null;
  days_until_renewal: number | null;
  risk_reason: string;
}

export interface AdminTrialConversion {
  user_id: string;
  email: string;
  display_name: string | null;
  plan: PlanTier;
  subscription_status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  signed_up_at: string;
  funnel_stage: string;
}

export interface AdminPowerUser {
  user_id: string;
  email: string;
  display_name: string | null;
  plan: PlanTier;
  subscription_status: SubscriptionStatus;
  country: string | null;
  last_active_at: string | null;
  sessions_30d: number;
  messages_30d: number;
  files_modified_30d: number;
  deploys_30d: number;
  hours_30d: number;
  total_tokens_30d: number;
  total_cost_30d: number;
  unique_features_30d: number;
}

export interface AdminFeatureAdoption {
  feature: string;
  total_uses: number;
  unique_users: number;
  uses_7d: number;
  uses_30d: number;
  unique_users_30d: number;
  first_used: string;
  last_used: string;
}

export interface AdminCohortRetention {
  cohort_month: string;
  cohort_size: number;
  active_month_0: number;
  active_month_1: number;
  active_month_2: number;
  active_month_3: number;
  active_month_4: number;
  active_month_5: number;
}

// ============================================================
// Audit Log
// ============================================================

export interface AdminAuditLogEntry {
  id: string;
  admin_id: string;
  admin_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================
// Waitlist
// ============================================================

export type WaitlistStatus = "waiting" | "invited" | "converted";

export interface WaitlistEntry {
  id: string;
  email: string;
  referral_source: string | null;
  status: WaitlistStatus;
  beta_opt_in: boolean;
  invited_at: string | null;
  created_at: string;
}