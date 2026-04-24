import { useEffect, useState, useMemo } from "react";
import {
  RefreshCw,
  Search,
  Copy,
  Check,
  Beaker,
  Mail,
  Users,
  Calendar,
  Clock,
} from "lucide-react";
import { getWaitlist } from "../../services/adminService";
import type { WaitlistEntry } from "../../types";

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [betaOnly, setBetaOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    const data = await getWaitlist("all");
    setEntries(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Stats
  const stats = useMemo(() => {
    const now = Date.now();
    const d24 = now - 24 * 60 * 60 * 1000;
    const d7 = now - 7 * 24 * 60 * 60 * 1000;
    const d30 = now - 30 * 24 * 60 * 60 * 1000;
    let in24h = 0,
      in7d = 0,
      in30d = 0,
      betaCount = 0;
    entries.forEach((e) => {
      const t = new Date(e.created_at).getTime();
      if (t >= d24) in24h++;
      if (t >= d7) in7d++;
      if (t >= d30) in30d++;
      if (e.beta_opt_in) betaCount++;
    });
    return {
      total: entries.length,
      beta: betaCount,
      in24h,
      in7d,
      in30d,
    };
  }, [entries]);

  // Filter + search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (betaOnly && !e.beta_opt_in) return false;
      if (!q) return true;
      return (
        e.email.toLowerCase().includes(q) ||
        (e.referral_source || "").toLowerCase().includes(q)
      );
    });
  }, [entries, search, betaOnly]);

  async function copyEmails() {
    const text = filtered.map((e) => e.email).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  return (
    <div style={{ padding: "24px 28px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "#DCE0E4",
              margin: 0,
              marginBottom: 4,
            }}
          >
            Waitlist
          </h1>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
            Everyone who signed up for early access
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            background: "transparent",
            border: "1px solid #555B63",
            borderRadius: 6,
            color: "#DCE0E4",
            fontSize: 12,
            fontFamily: "'Sora', sans-serif",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
          }}
        >
          <RefreshCw
            size={12}
            style={{
              animation: loading ? "spin 1s linear infinite" : "none",
            }}
          />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <StatCard
          icon={<Users size={14} strokeWidth={1.6} />}
          label="Total joined"
          value={formatNumber(stats.total)}
        />
        <StatCard
          icon={<Beaker size={14} strokeWidth={1.6} />}
          label="Beta testers"
          value={formatNumber(stats.beta)}
          sub={
            stats.total > 0
              ? `${Math.round((stats.beta / stats.total) * 100)}% opted in`
              : undefined
          }
          accent
        />
        <StatCard
          icon={<Clock size={14} strokeWidth={1.6} />}
          label="Last 24 hours"
          value={formatNumber(stats.in24h)}
        />
        <StatCard
          icon={<Calendar size={14} strokeWidth={1.6} />}
          label="Last 7 days"
          value={formatNumber(stats.in7d)}
        />
        <StatCard
          icon={<Calendar size={14} strokeWidth={1.6} />}
          label="Last 30 days"
          value={formatNumber(stats.in30d)}
        />
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
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
            placeholder="Search email or referral source..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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

        <button
          onClick={() => setBetaOnly((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 10px",
            background: betaOnly ? "rgba(45, 184, 122, 0.15)" : "transparent",
            border: `1px solid ${betaOnly ? "#2DB87A" : "#555B63"}`,
            borderRadius: 6,
            color: betaOnly ? "#5DE8A0" : "#9CA3AF",
            fontSize: 12,
            fontFamily: "'Sora', sans-serif",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <Beaker size={12} strokeWidth={1.6} />
          Beta testers only
        </button>

        <button
          onClick={copyEmails}
          disabled={filtered.length === 0}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 10px",
            background: "transparent",
            border: "1px solid #555B63",
            borderRadius: 6,
            color: "#DCE0E4",
            fontSize: 12,
            fontFamily: "'Sora', sans-serif",
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            opacity: filtered.length === 0 ? 0.5 : 1,
          }}
          title={`Copy ${filtered.length} email${filtered.length === 1 ? "" : "s"} to clipboard`}
        >
          {copied ? (
            <>
              <Check size={12} color="#2DB87A" /> Copied!
            </>
          ) : (
            <>
              <Copy size={12} /> Copy emails ({filtered.length})
            </>
          )}
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
                <Th>Email</Th>
                <Th>Beta</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}
                  >
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: 50,
                      textAlign: "center",
                      color: "#9CA3AF",
                    }}
                  >
                    <Mail
                      size={24}
                      strokeWidth={1.5}
                      style={{ marginBottom: 10 }}
                    />
                    <div style={{ fontSize: 13, color: "#DCE0E4" }}>
                      {entries.length === 0
                        ? "No signups yet"
                        : "No entries match filters"}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((e) => (
                  <tr
                    key={e.id}
                    style={{
                      borderTop: "1px solid #383C43",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(ev) =>
                      ((ev.currentTarget as HTMLTableRowElement).style.background =
                        "#2F3238")
                    }
                    onMouseLeave={(ev) =>
                      ((ev.currentTarget as HTMLTableRowElement).style.background =
                        "transparent")
                    }
                  >
                    <Td>
                      <span style={{ color: "#DCE0E4" }}>{e.email}</span>
                    </Td>
                    <Td>
                      {e.beta_opt_in ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 7px",
                            background: "rgba(45,184,122,0.15)",
                            color: "#5DE8A0",
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            borderRadius: 4,
                          }}
                        >
                          <Beaker size={10} strokeWidth={2} />
                          Beta
                        </span>
                      ) : (
                        <span style={{ color: "#6B7280" }}>—</span>
                      )}
                    </Td>
                    <Td>
                      <span style={{ color: "#9CA3AF" }}>
                        {e.referral_source || "—"}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={e.status} />
                    </Td>
                    <Td>
                      <div>
                        <div style={{ color: "#DCE0E4" }}>
                          {formatDate(e.created_at)}
                        </div>
                        <div style={{ color: "#6B7280", fontSize: 11 }}>
                          {formatRelative(e.created_at)}
                        </div>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// --- Subcomponents ---

function StatCard({
  icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: "#262A2F",
        border: "1px solid #383C43",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "#9CA3AF",
          marginBottom: 6,
        }}
      >
        <span style={{ color: "#6B7280" }}>{icon}</span>
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 500,
          color: accent ? "#2DB87A" : "#DCE0E4",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
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

function Td({ children }: { children?: React.ReactNode }) {
  return (
    <td
      style={{
        padding: "11px 14px",
        color: "#DCE0E4",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    waiting: { bg: "#383C43", color: "#DCE0E4" },
    invited: { bg: "rgba(245, 158, 11, 0.15)", color: "#FCD34D" },
    converted: { bg: "rgba(45, 184, 122, 0.15)", color: "#5DE8A0" },
  };
  const c = colors[status] || colors.waiting;
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
      {status}
    </span>
  );
}

// --- Formatters ---

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string): string {
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