import { useEffect, useState } from "react";
import {
  Users,
  UserPlus,
  CreditCard,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { getRevenueSummary } from "../../services/adminService";
import type { AdminRevenueSummary } from "../../types";

export default function OverviewPage() {
  const [summary, setSummary] = useState<AdminRevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const data = await getRevenueSummary();
    setSummary(data);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: "24px 28px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
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
            Overview
          </h1>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
            Snapshot of Omnirun across all users
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
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
            cursor: refreshing ? "not-allowed" : "pointer",
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          <RefreshCw
            size={12}
            style={{
              animation: refreshing ? "spin 1s linear infinite" : "none",
            }}
          />
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
          Loading...
        </div>
      ) : !summary ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "#9CA3AF",
            background: "#262A2F",
            border: "1px solid #383C43",
            borderRadius: 8,
          }}
        >
          Unable to load summary. Check your admin permissions and connection.
        </div>
      ) : (
        <>
          {/* Main metrics row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <MetricCard
              icon={<Users size={16} strokeWidth={1.6} />}
              label="Total users"
              value={formatNumber(summary.total_users)}
            />
            <MetricCard
              icon={<UserPlus size={16} strokeWidth={1.6} />}
              label="Signups (30 days)"
              value={formatNumber(summary.signups_30d)}
              sub={`${formatNumber(summary.signups_7d)} in last 7 days`}
            />
            <MetricCard
              icon={<CreditCard size={16} strokeWidth={1.6} />}
              label="Active subscriptions"
              value={formatNumber(summary.active_subscriptions)}
            />
            <MetricCard
              icon={<TrendingUp size={16} strokeWidth={1.6} />}
              label="MRR"
              value={formatCurrency(summary.mrr)}
              accent
            />
          </div>

          {/* Plan breakdown */}
          <div
            style={{
              background: "#262A2F",
              border: "1px solid #383C43",
              borderRadius: 8,
              padding: 18,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#9CA3AF",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 14,
              }}
            >
              Active subscriptions by plan
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              <PlanCell name="Starter" count={summary.starter_count} />
              <PlanCell name="Pro" count={summary.pro_count} />
              <PlanCell name="Business" count={summary.business_count} />
              <PlanCell name="Enterprise" count={summary.enterprise_count} />
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function MetricCard({
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
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "#9CA3AF",
          marginBottom: 8,
          letterSpacing: "0.03em",
        }}
      >
        <span style={{ color: "#6B7280" }}>{icon}</span>
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 500,
          color: accent ? "#2DB87A" : "#DCE0E4",
          letterSpacing: "-0.01em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#6B7280", marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}

function PlanCell({ name, count }: { name: string; count: number }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "#2F3238",
        border: "1px solid #383C43",
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 4 }}>
        {name}
      </div>
      <div style={{ fontSize: 18, fontWeight: 500, color: "#DCE0E4" }}>
        {formatNumber(count)}
      </div>
    </div>
  );
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}