import { getSupabase } from "../lib/supabase";
import type {
  AdminUserOverview,
  AdminRevenueSummary,
  AdminRevenueAtRisk,
  AdminTrialConversion,
  AdminPowerUser,
  AdminFeatureAdoption,
  AdminCohortRetention,
  AdminAuditLogEntry,
  WaitlistEntry,
  WaitlistStatus,
  PlanTier,
  Profile,
} from "../types";

// ============================================================
// Overview / Revenue
// ============================================================

export async function getRevenueSummary(): Promise<AdminRevenueSummary | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_revenue_summary")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getRevenueSummary error:", error);
    return null;
  }
  return data as AdminRevenueSummary | null;
}

export async function getRevenueAtRisk(): Promise<AdminRevenueAtRisk[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_revenue_at_risk")
    .select("*");
  if (error) {
    console.error("getRevenueAtRisk error:", error);
    return [];
  }
  return (data || []) as AdminRevenueAtRisk[];
}

export async function getTrialConversions(): Promise<AdminTrialConversion[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_trial_conversions")
    .select("*");
  if (error) {
    console.error("getTrialConversions error:", error);
    return [];
  }
  return (data || []) as AdminTrialConversion[];
}

// ============================================================
// Users
// ============================================================

export interface UserFilters {
  search?: string;
  plan?: PlanTier | "all";
  status?: string | "all";
  bannedOnly?: boolean;
  adminsOnly?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: keyof AdminUserOverview;
  orderDir?: "asc" | "desc";
}

export async function getUsers(
  filters: UserFilters = {}
): Promise<{ users: AdminUserOverview[]; count: number }> {
  const supabase = getSupabase();
  const {
    search,
    plan,
    status,
    bannedOnly,
    adminsOnly,
    limit = 50,
    offset = 0,
    orderBy = "signed_up_at",
    orderDir = "desc",
  } = filters;

  let query = supabase
    .from("admin_user_overview")
    .select("*", { count: "exact" });

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query = query.or(`email.ilike.${s},display_name.ilike.${s}`);
  }
  if (plan && plan !== "all") query = query.eq("plan", plan);
  if (status && status !== "all") query = query.eq("subscription_status", status);
  if (bannedOnly) query = query.eq("is_banned", true);
  if (adminsOnly) query = query.eq("is_admin", true);

  query = query
    .order(orderBy, { ascending: orderDir === "asc" })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error("getUsers error:", error);
    return { users: [], count: 0 };
  }
  return { users: (data || []) as AdminUserOverview[], count: count || 0 };
}

export async function getUserById(
  userId: string
): Promise<AdminUserOverview | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_user_overview")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("getUserById error:", error);
    return null;
  }
  return data as AdminUserOverview | null;
}

export async function updateProfile(
  userId: string,
  updates: Partial<Profile>
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId);
  if (error) {
    console.error("updateProfile error:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ============================================================
// Power Users / Engagement
// ============================================================

export async function getPowerUsers(): Promise<AdminPowerUser[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_power_users")
    .select("*")
    .limit(100);
  if (error) {
    console.error("getPowerUsers error:", error);
    return [];
  }
  return (data || []) as AdminPowerUser[];
}

export async function getFeatureAdoption(): Promise<AdminFeatureAdoption[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_feature_adoption")
    .select("*");
  if (error) {
    console.error("getFeatureAdoption error:", error);
    return [];
  }
  return (data || []) as AdminFeatureAdoption[];
}

export async function getCohortRetention(): Promise<AdminCohortRetention[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_cohort_retention")
    .select("*");
  if (error) {
    console.error("getCohortRetention error:", error);
    return [];
  }
  return (data || []) as AdminCohortRetention[];
}

// ============================================================
// Audit Log
// ============================================================

export async function getAuditLog(
  limit = 200
): Promise<AdminAuditLogEntry[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("getAuditLog error:", error);
    return [];
  }
  return (data || []) as AdminAuditLogEntry[];
}

export async function logAdminAction(
  action: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from("admin_audit_log").insert({
    admin_id: user.id,
    admin_email: user.email,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
  });
  if (error) console.error("logAdminAction error:", error);
}

// ============================================================
// Waitlist
// ============================================================

export async function getWaitlist(
  status?: WaitlistStatus | "all"
): Promise<WaitlistEntry[]> {
  const supabase = getSupabase();
  let query = supabase
    .from("waitlist")
    .select("*")
    .order("created_at", { ascending: true });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("getWaitlist error:", error);
    return [];
  }
  return (data || []) as WaitlistEntry[];
}

export async function markWaitlistInvited(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("waitlist")
    .update({ status: "invited", invited_at: new Date().toISOString() })
    .in("id", ids);
  if (error) {
    console.error("markWaitlistInvited error:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}