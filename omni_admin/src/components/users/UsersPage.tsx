import { useEffect, useState, useCallback } from "react";
import {
  Search,
  ShieldCheck,
  Ban,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { getUsers } from "../../services/adminService";
import type { AdminUserOverview, PlanTier, SubscriptionStatus } from "../../types";
import UserDetailDrawer from "./UserDetailDrawer";

const PAGE_SIZE = 50;

const PLAN_OPTIONS: Array<{ value: PlanTier | "all"; label: string }> = [
  { value: "all", label: "All plans" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "studio", label: "Studio" },
  { value: "team", label: "Team" },
  { value: "business", label: "Business" },
  { value: "enterprise", label: "Enterprise" },
];

const STATUS_OPTIONS: Array<{ value: SubscriptionStatus | "all"; label: string }> = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "trialing", label: "Trialing" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
  { value: "unpaid", label: "Unpaid" },
  { value: "paused", label: "Paused" },
  { value: "incomplete", label: "Incomplete" },
  { value: "incomplete_expired", label: "Incomplete expired" },
];

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUserOverview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [plan, setPlan] = useState<PlanTier | "all">("all");
  const [status, setStatus] = useState<SubscriptionStatus | "all">("all");
  const [adminsOnly, setAdminsOnly] = useState(false);
  const [bannedOnly, setBannedOnly] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { users, count } = await getUsers({
      search,
      plan,
      status,
      adminsOnly,
      bannedOnly,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    setUsers(users);
    setTotal(count);
    setLoading(false);
  }, [search, plan, status, adminsOnly, bannedOnly, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ marginBottom: 18 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: "#DCE0E4",
            margin: 0,
            marginBottom: 4,
          }}
        >
          Users
        </h1>
        <div style={{ fontSize: 12, color: "#9CA3AF" }}>
          {total > 0
            ? `${formatNumber(total)} ${total === 1 ? "user" : "users"}`
            : "All registered users"}
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 280px", minWidth: 240 }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#6B7280",
            }}
          />
          <input
            placeholder="Search by email or name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px 8px 32px",
              background: "#262A2F",
              border: "1px solid #4A4F57",
              borderRadius: 6,
              color: "#DCE0E4",
              fontSize: 13,
              fontFamily: "'Sora', sans-serif",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <select
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value as PlanTier | "all");
            setPage(0);
          }}
          style={selectStyle}
        >
          {PLAN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as SubscriptionStatus | "all");
            setPage(0);
          }}
          style={selectStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <ToggleChip
          active={adminsOnly}
          onToggle={() => {
            setAdminsOnly((v) => !v);
            setPage(0);
          }}
          label="Admins only"
        />
        <ToggleChip
          active={bannedOnly}
          onToggle={() => {
            setBannedOnly((v) => !v);
            setPage(0);
          }}
          label="Banned only"
        />

        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "7px 10px",
            background: "transparent",
            border: "1px solid #555B63",
            borderRadius: 6,
            color: "#DCE0E4",
            fontSize: 12,
            fontFamily: "'Sora', sans-serif",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
          }}
          title="Refresh"
        >
          <RefreshCw
            size={12}
            style={{
              animation: loading ? "spin 1s linear infinite" : "none",
            }}
          />
        </button>
      </div>

      {/* Table */}
      <div
        style={{
          background: "#262A2F",
          border: "1px solid #383C43",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ background: "#2F3238" }}>
                <Th>User</Th>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th>Country</Th>
                <Th>Signed up</Th>
                <Th>Last active</Th>
                <Th align="right">30d cost</Th>
                <Th align="right">Lifetime</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
                    Loading...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
                    No users match these filters
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.user_id}
                    onClick={() => setSelectedUserId(u.user_id)}
                    style={{
                      cursor: "pointer",
                      borderTop: "1px solid #383C43",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLTableRowElement).style.background =
                        "#2F3238")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLTableRowElement).style.background =
                        "transparent")
                    }
                  >
                    <Td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div>
                          <div style={{ color: "#DCE0E4", marginBottom: 2 }}>
                            {u.display_name || u.email.split("@")[0]}
                          </div>
                          <div style={{ color: "#9CA3AF", fontSize: 11 }}>
                            {u.email}
                          </div>
                        </div>
                        {u.is_admin && (
                          <ShieldCheck
                            size={12}
                            color="#2DB87A"
                            strokeWidth={2}
                            style={{ marginLeft: 4 }}
                          />
                        )}
                        {u.is_banned && (
                          <Ban
                            size={12}
                            color="#EF4444"
                            strokeWidth={2}
                            style={{ marginLeft: 4 }}
                          />
                        )}
                      </div>
                    </Td>
                    <Td>
                      <PlanBadge plan={u.plan} />
                    </Td>
                    <Td>
                      <StatusBadge status={u.subscription_status} />
                    </Td>
                    <Td>{u.country || "—"}</Td>
                    <Td>{formatDate(u.signed_up_at)}</Td>
                    <Td>{formatRelative(u.last_active_at)}</Td>
                    <Td align="right">{formatCurrency(u.cost_30d)}</Td>
                    <Td align="right">{formatCurrency(u.lifetime_cost)}</Td>
                    <Td align="right">
                      <ChevronRight size={14} color="#6B7280" />
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px",
              borderTop: "1px solid #383C43",
              background: "#2F3238",
            }}
          >
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>
              Page {page + 1} of {totalPages} · {formatNumber(total)} total
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <PageButton
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft size={14} />
              </PageButton>
              <PageButton
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                <ChevronRight size={14} />
              </PageButton>
            </div>
          </div>
        )}
      </div>

      {selectedUserId && (
        <UserDetailDrawer
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onUpdated={load}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        select option {
          background: #262A2F;
          color: #DCE0E4;
        }
      `}</style>
    </div>
  );
}

// --- Subcomponents ---

function Th({ children, align }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        textAlign: align || "left",
        padding: "10px 14px",
        fontSize: 11,
        fontWeight: 600,
        color: "#9CA3AF",
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        borderBottom: "1px solid #383C43",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align || "left",
        padding: "11px 14px",
        color: "#DCE0E4",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function PlanBadge({ plan }: { plan: PlanTier }) {
  const colors: Record<PlanTier, { bg: string; color: string }> = {
    starter: { bg: "#383C43", color: "#DCE0E4" },
    pro: { bg: "rgba(45, 184, 122, 0.15)", color: "#5DE8A0" },
    studio: { bg: "rgba(124, 58, 237, 0.18)", color: "#C4B5FD" },
    team: { bg: "rgba(59, 130, 246, 0.15)", color: "#93C5FD" },
    business: { bg: "rgba(245, 158, 11, 0.15)", color: "#FCD34D" },
    enterprise: { bg: "rgba(236, 72, 153, 0.15)", color: "#F9A8D4" },
  };
  const c = colors[plan] || colors.starter;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 7px",
        background: c.bg,
        color: c.color,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        borderRadius: 4,
      }}
    >
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const dotColors: Record<SubscriptionStatus, string> = {
    active: "#2DB87A",
    trialing: "#F59E0B",
    past_due: "#EF4444",
    canceled: "#6B7280",
    unpaid: "#EF4444",
    paused: "#9CA3AF",
    incomplete: "#9CA3AF",
    incomplete_expired: "#6B7280",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "#DCE0E4",
        fontSize: 11,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dotColors[status] || "#6B7280",
          display: "inline-block",
        }}
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ToggleChip({
  active,
  onToggle,
  label,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        padding: "7px 10px",
        background: active ? "rgba(45, 184, 122, 0.15)" : "transparent",
        border: `1px solid ${active ? "#2DB87A" : "#555B63"}`,
        borderRadius: 6,
        color: active ? "#5DE8A0" : "#9CA3AF",
        fontSize: 12,
        fontFamily: "'Sora', sans-serif",
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </button>
  );
}

function PageButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: disabled ? "#262A2F" : "transparent",
        border: "1px solid #555B63",
        borderRadius: 4,
        color: disabled ? "#6B7280" : "#DCE0E4",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#262A2F",
  border: "1px solid #4A4F57",
  borderRadius: 6,
  color: "#DCE0E4",
  fontSize: 12,
  fontFamily: "'Sora', sans-serif",
  outline: "none",
  cursor: "pointer",
};

// --- Formatters ---

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}