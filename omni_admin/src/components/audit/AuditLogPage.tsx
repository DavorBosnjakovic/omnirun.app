import { useEffect, useState, useMemo } from "react";
import { RefreshCw, Search, ScrollText } from "lucide-react";
import { getAuditLog } from "../../services/adminService";
import type { AdminAuditLogEntry } from "../../types";

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AdminAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    const data = await getAuditLog(500);
    setEntries(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Build unique action list for the filter dropdown
  const uniqueActions = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.action));
    return Array.from(set).sort();
  }, [entries]);

  // Apply filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!q) return true;
      const hay = [
        e.action,
        e.admin_email || "",
        e.target_type || "",
        e.target_id || "",
        JSON.stringify(e.details || {}),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search, actionFilter]);

  // Group entries by day for timeline display
  const grouped = useMemo(() => {
    const groups: Record<string, AdminAuditLogEntry[]> = {};
    filtered.forEach((e) => {
      const key = new Date(e.created_at).toDateString();
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return Object.entries(groups);
  }, [filtered]);

  return (
    <div style={{ padding: "24px 28px" }}>
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
            Audit log
          </h1>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
            {search || actionFilter !== "all" ? " (filtered)" : ""} · showing most
            recent 500
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

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
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
            placeholder="Search admin, action, target, details..."
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

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{
            padding: "8px 10px",
            background: "#262A2F",
            border: "1px solid #4A4F57",
            borderRadius: 6,
            color: "#DCE0E4",
            fontSize: 12,
            fontFamily: "'Sora', sans-serif",
            outline: "none",
            cursor: "pointer",
            minWidth: 180,
          }}
        >
          <option value="all">All actions</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#9CA3AF" }}>
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "#9CA3AF",
            background: "#262A2F",
            border: "1px solid #383C43",
            borderRadius: 8,
          }}
        >
          <ScrollText size={26} strokeWidth={1.5} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: "#DCE0E4", marginBottom: 4 }}>
            No audit entries
          </div>
          <div style={{ fontSize: 12 }}>
            {search || actionFilter !== "all"
              ? "Try adjusting the filters above"
              : "Admin actions will appear here as they happen"}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "#262A2F",
            border: "1px solid #383C43",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {grouped.map(([dayKey, items], gi) => (
            <div key={dayKey}>
              {/* Day header */}
              <div
                style={{
                  padding: "10px 16px",
                  background: "#2F3238",
                  borderTop: gi === 0 ? "none" : "1px solid #383C43",
                  borderBottom: "1px solid #383C43",
                  fontSize: 11,
                  color: "#9CA3AF",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                {formatDayLabel(dayKey)}
              </div>

              {items.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </div>
          ))}
        </div>
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

// --- Entry row ---

function Entry({ entry }: { entry: AdminAuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    entry.details && Object.keys(entry.details).length > 0;

  return (
    <div
      onClick={() => hasDetails && setExpanded((v) => !v)}
      style={{
        padding: "12px 16px",
        borderTop: "1px solid #383C43",
        cursor: hasDetails ? "pointer" : "default",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) =>
        hasDetails &&
        ((e.currentTarget as HTMLDivElement).style.background = "#2F3238")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background = "transparent")
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#6B7280",
            width: 58,
            flexShrink: 0,
            paddingTop: 1,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {formatTime(entry.created_at)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 2,
            }}
          >
            <ActionBadge action={entry.action} />
            <span style={{ fontSize: 12, color: "#9CA3AF" }}>by</span>
            <span style={{ fontSize: 12, color: "#DCE0E4" }}>
              {entry.admin_email || "unknown"}
            </span>
          </div>

          {entry.target_type && (
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>
              Target: {entry.target_type}
              {entry.target_id && (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    marginLeft: 4,
                    color: "#6B7280",
                  }}
                >
                  ({entry.target_id.slice(0, 8)}...)
                </span>
              )}
            </div>
          )}

          {hasDetails && expanded && (
            <pre
              style={{
                marginTop: 8,
                padding: 10,
                background: "#1E2124",
                border: "1px solid #383C43",
                borderRadius: 4,
                fontSize: 11,
                color: "#DCE0E4",
                fontFamily: "'JetBrains Mono', monospace",
                overflow: "auto",
                maxHeight: 200,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          )}

          {hasDetails && !expanded && (
            <div
              style={{
                fontSize: 11,
                color: "#6B7280",
                marginTop: 4,
              }}
            >
              Click to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Helpers ---

function ActionBadge({ action }: { action: string }) {
  const { bg, color } = getActionColor(action);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 7px",
        background: bg,
        color,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.03em",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {action}
    </span>
  );
}

function getActionColor(action: string): { bg: string; color: string } {
  // Destructive actions - red
  if (/ban|delet|remov|revok|kill|disabl/i.test(action)) {
    return { bg: "rgba(239,68,68,0.15)", color: "#FCA5A5" };
  }
  // Grant / enable / create - green
  if (/grant|enabl|creat|activ|restor|approv|unban/i.test(action)) {
    return { bg: "rgba(45,184,122,0.15)", color: "#5DE8A0" };
  }
  // Changes / updates - amber
  if (/chang|updat|edit|extend|modif/i.test(action)) {
    return { bg: "rgba(245,158,11,0.15)", color: "#FCD34D" };
  }
  // Default - gray
  return { bg: "#383C43", color: "#DCE0E4" };
}

function formatDayLabel(dateKey: string): string {
  const d = new Date(dateKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dDay = new Date(d);
  dDay.setHours(0, 0, 0, 0);

  if (dDay.getTime() === today.getTime()) return "Today";
  if (dDay.getTime() === yesterday.getTime()) return "Yesterday";

  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}