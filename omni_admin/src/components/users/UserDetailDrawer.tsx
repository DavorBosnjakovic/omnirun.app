import { useEffect, useState } from "react";
import {
  X,
  ShieldCheck,
  ShieldOff,
  Ban,
  CheckCircle2,
  Mail,
  Calendar,
  Globe,
  Monitor,
  DollarSign,
  Activity,
  Users2,
  Save,
} from "lucide-react";
import {
  getUserById,
  updateProfile,
  logAdminAction,
} from "../../services/adminService";
import type {
  AdminUserOverview,
  PlanTier,
  SubscriptionStatus,
} from "../../types";

const PLAN_OPTIONS: PlanTier[] = [
  "starter",
  "pro",
  "studio",
  "team",
  "business",
  "enterprise",
];

interface Props {
  userId: string;
  onClose: () => void;
  onUpdated: () => void;
}

export default function UserDetailDrawer({ userId, onClose, onUpdated }: Props) {
  const [user, setUser] = useState<AdminUserOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable local state
  const [plan, setPlan] = useState<PlanTier>("starter");
  const [adminNotes, setAdminNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  async function load() {
    setLoading(true);
    const u = await getUserById(userId);
    setUser(u);
    if (u) {
      setPlan(u.plan);
      setAdminNotes(u.admin_notes || "");
      setNotesDirty(false);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function applyUpdate(
    updates: Record<string, unknown>,
    action: string,
    details: Record<string, unknown> = {}
  ) {
    setSaving(true);
    setError(null);
    const res = await updateProfile(userId, updates as never);
    if (!res.ok) {
      setError(res.error || "Update failed");
      setSaving(false);
      return;
    }
    await logAdminAction(action, "profile", userId, details);
    await load();
    onUpdated();
    setSaving(false);
  }

  async function toggleBan() {
    if (!user) return;
    const next = !user.is_banned;
    const confirm = window.confirm(
      next
        ? `Ban ${user.email}? They will lose access to the app.`
        : `Unban ${user.email}?`
    );
    if (!confirm) return;
    await applyUpdate(
      { is_banned: next },
      next ? "user_banned" : "user_unbanned",
      { email: user.email }
    );
  }

  async function toggleAdmin() {
    if (!user) return;
    const next = !user.is_admin;
    const confirm = window.confirm(
      next
        ? `Grant admin access to ${user.email}?`
        : `Revoke admin access from ${user.email}?`
    );
    if (!confirm) return;
    await applyUpdate(
      { is_admin: next },
      next ? "admin_granted" : "admin_revoked",
      { email: user.email }
    );
  }

  async function savePlan() {
    if (!user || plan === user.plan) return;
    await applyUpdate(
      { plan },
      "plan_changed",
      { email: user.email, from: user.plan, to: plan }
    );
  }

  async function extendTrial(days: number) {
    if (!user) return;
    const base = user.trial_ends_at
      ? new Date(user.trial_ends_at)
      : new Date();
    if (base.getTime() < Date.now()) base.setTime(Date.now());
    base.setDate(base.getDate() + days);
    await applyUpdate(
      { trial_ends_at: base.toISOString() },
      "trial_extended",
      { email: user.email, days, new_end: base.toISOString() }
    );
  }

  async function saveNotes() {
    if (!user) return;
    await applyUpdate(
      { admin_notes: adminNotes || null },
      "admin_notes_updated",
      { email: user.email }
    );
    setNotesDirty(false);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.5)",
          zIndex: 100,
          animation: "fadeIn 0.15s ease",
        }}
      />

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(560px, 100vw)",
          background: "#262A2F",
          borderLeft: "1px solid #383C43",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.3)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          fontFamily: "'Sora', sans-serif",
          animation: "slideIn 0.2s ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #383C43",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>User details</div>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              borderRadius: 4,
              color: "#DCE0E4",
              cursor: "pointer",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "#383C43")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "transparent")
            }
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
              Loading...
            </div>
          ) : !user ? (
            <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
              User not found
            </div>
          ) : (
            <>
              {/* Identity */}
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 500,
                      color: "#DCE0E4",
                    }}
                  >
                    {user.display_name || user.email.split("@")[0]}
                  </div>
                  {user.is_admin && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        padding: "2px 6px",
                        background: "rgba(45,184,122,0.15)",
                        color: "#5DE8A0",
                        borderRadius: 4,
                      }}
                    >
                      Admin
                    </span>
                  )}
                  {user.is_banned && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        padding: "2px 6px",
                        background: "rgba(239,68,68,0.15)",
                        color: "#FCA5A5",
                        borderRadius: 4,
                      }}
                    >
                      Banned
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                  <Mail
                    size={11}
                    style={{ display: "inline", marginRight: 4, verticalAlign: -1 }}
                  />
                  {user.email}
                </div>
                <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>
                  ID: {user.user_id}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div
                  style={{
                    padding: "8px 10px",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 6,
                    color: "#FCA5A5",
                    fontSize: 12,
                    marginBottom: 16,
                  }}
                >
                  {error}
                </div>
              )}

              {/* Subscription */}
              <Section title="Subscription">
                <Row label="Plan">
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select
                      value={plan}
                      onChange={(e) => setPlan(e.target.value as PlanTier)}
                      disabled={saving}
                      style={selectStyle}
                    >
                      {PLAN_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    {plan !== user.plan && (
                      <button
                        onClick={savePlan}
                        disabled={saving}
                        style={primaryBtnStyle}
                      >
                        <Save size={12} /> Save
                      </button>
                    )}
                  </div>
                </Row>
                <Row label="Status">{statusText(user.subscription_status)}</Row>
                <Row label="Billing interval">
                  {user.billing_interval || "—"}
                </Row>
                <Row label="Current period ends">
                  {formatDateTime(user.current_period_end)}
                </Row>
                <Row label="Cancel at">{formatDateTime(user.cancel_at)}</Row>
              </Section>

              {/* Trial */}
              <Section title="Trial">
                <Row label="Trial started">
                  {formatDateTime(user.trial_started_at)}
                </Row>
                <Row label="Trial ends">
                  {formatDateTime(user.trial_ends_at)}
                </Row>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => extendTrial(7)}
                    disabled={saving}
                    style={secondaryBtnStyle}
                  >
                    +7 days
                  </button>
                  <button
                    onClick={() => extendTrial(14)}
                    disabled={saving}
                    style={secondaryBtnStyle}
                  >
                    +14 days
                  </button>
                  <button
                    onClick={() => extendTrial(30)}
                    disabled={saving}
                    style={secondaryBtnStyle}
                  >
                    +30 days
                  </button>
                </div>
              </Section>

              {/* Usage */}
              <Section title="Usage">
                <Row label={<><DollarSign size={11} style={inlineIcon} />Lifetime cost</>}>
                  {formatCurrency(user.lifetime_cost)}
                </Row>
                <Row label="Lifetime tokens">
                  {formatNumber(user.lifetime_tokens)}
                </Row>
                <Row label="Lifetime API calls">
                  {formatNumber(user.lifetime_api_calls)}
                </Row>
                <Row label="30-day cost">{formatCurrency(user.cost_30d)}</Row>
                <Row label="30-day tokens">{formatNumber(user.tokens_30d)}</Row>
                <Row label="Top provider">{user.top_provider || "—"}</Row>
                <Row label="Top model">{user.top_model || "—"}</Row>
              </Section>

              {/* Activity */}
              <Section title="Activity">
                <Row label={<><Activity size={11} style={inlineIcon} />Total sessions</>}>
                  {formatNumber(user.total_sessions)}
                </Row>
                <Row label="Last active">
                  {formatDateTime(user.last_active_at)}
                </Row>
                <Row label="Project count">
                  {formatNumber(user.project_count)}
                </Row>
              </Section>

              {/* Team */}
              {user.team_name && (
                <Section title="Team">
                  <Row label={<><Users2 size={11} style={inlineIcon} />Team</>}>
                    {user.team_name}
                  </Row>
                  <Row label="Role">{user.team_role || "—"}</Row>
                </Section>
              )}

              {/* App & environment */}
              <Section title="Environment">
                <Row label={<><Calendar size={11} style={inlineIcon} />Signed up</>}>
                  {formatDateTime(user.signed_up_at)}
                </Row>
                <Row label="Auth provider">{user.auth_provider || "—"}</Row>
                <Row label="Signup source">{user.signup_source || "—"}</Row>
                <Row label={<><Monitor size={11} style={inlineIcon} />OS</>}>
                  {user.os || "—"}
                </Row>
                <Row label="App version">{user.app_version || "—"}</Row>
                <Row label={<><Globe size={11} style={inlineIcon} />Country</>}>
                  {user.country || "—"}
                </Row>
                <Row label="Timezone">{user.timezone || "—"}</Row>
              </Section>

              {/* Admin notes */}
              <Section title="Admin notes">
                <textarea
                  value={adminNotes}
                  onChange={(e) => {
                    setAdminNotes(e.target.value);
                    setNotesDirty(e.target.value !== (user.admin_notes || ""));
                  }}
                  placeholder="Internal notes, visible to admins only..."
                  rows={4}
                  style={{
                    width: "100%",
                    padding: 10,
                    background: "#2F3238",
                    border: "1px solid #4A4F57",
                    borderRadius: 6,
                    color: "#DCE0E4",
                    fontSize: 12,
                    fontFamily: "'Sora', sans-serif",
                    outline: "none",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
                {notesDirty && (
                  <button
                    onClick={saveNotes}
                    disabled={saving}
                    style={{ ...primaryBtnStyle, marginTop: 8 }}
                  >
                    <Save size={12} /> Save notes
                  </button>
                )}
              </Section>
            </>
          )}
        </div>

        {/* Footer - danger actions */}
        {user && !loading && (
          <div
            style={{
              borderTop: "1px solid #383C43",
              padding: 14,
              display: "flex",
              gap: 8,
              flexShrink: 0,
              background: "#2F3238",
            }}
          >
            <button
              onClick={toggleAdmin}
              disabled={saving}
              style={{
                ...secondaryBtnStyle,
                flex: 1,
                justifyContent: "center",
                padding: "9px 12px",
              }}
            >
              {user.is_admin ? (
                <>
                  <ShieldOff size={13} /> Revoke admin
                </>
              ) : (
                <>
                  <ShieldCheck size={13} /> Make admin
                </>
              )}
            </button>
            <button
              onClick={toggleBan}
              disabled={saving}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                flex: 1,
                padding: "9px 12px",
                background: user.is_banned
                  ? "rgba(45,184,122,0.1)"
                  : "rgba(239,68,68,0.1)",
                border: `1px solid ${user.is_banned ? "#2DB87A" : "#EF4444"}`,
                borderRadius: 6,
                color: user.is_banned ? "#5DE8A0" : "#FCA5A5",
                fontSize: 12,
                fontFamily: "'Sora', sans-serif",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              {user.is_banned ? (
                <>
                  <CheckCircle2 size={13} /> Unban
                </>
              ) : (
                <>
                  <Ban size={13} /> Ban user
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        select option {
          background: #262A2F;
          color: #DCE0E4;
        }
      `}</style>
    </>
  );
}

// --- Subcomponents ---

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#9CA3AF",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: "1px solid #383C43",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 0",
        fontSize: 12,
        gap: 12,
      }}
    >
      <div style={{ color: "#9CA3AF", flexShrink: 0 }}>{label}</div>
      <div
        style={{
          color: "#DCE0E4",
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// --- Styles ---

const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "#2F3238",
  border: "1px solid #4A4F57",
  borderRadius: 4,
  color: "#DCE0E4",
  fontSize: 12,
  fontFamily: "'Sora', sans-serif",
  outline: "none",
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 10px",
  background: "#2DB87A",
  border: "none",
  borderRadius: 4,
  color: "#FFFFFF",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "'Sora', sans-serif",
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 10px",
  background: "transparent",
  border: "1px solid #555B63",
  borderRadius: 4,
  color: "#DCE0E4",
  fontSize: 11,
  fontFamily: "'Sora', sans-serif",
  cursor: "pointer",
};

const inlineIcon: React.CSSProperties = {
  display: "inline",
  marginRight: 4,
  verticalAlign: -1,
  color: "#6B7280",
};

// --- Formatters ---

function statusText(s: SubscriptionStatus): string {
  return s.replace(/_/g, " ");
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}