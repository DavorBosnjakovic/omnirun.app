import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useUsageStore } from "../../stores/usageStore";
import type { SessionSummary } from "../../stores/usageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { dbService } from "../../services/dbService";
import { useProjectStore } from "../../stores/projectStore";
import { ChevronDown, ChevronRight } from "lucide-react";

type Timeframe = "session" | "today" | "week" | "month" | "year" | "alltime";
type ChartType = "bar" | "line";
type GraphMetric = "cost" | "input" | "output" | "cached" | "combined";
type FilterSource = "all" | "assistant" | "project";

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  session: "Session",
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  alltime: "All Time",
};

function getDateRange(tf: Timeframe): { fromDate?: number; toDate?: number } {
  const now = new Date();
  if (tf === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { fromDate: start.getTime(), toDate: now.getTime() };
  }
  if (tf === "week") {
    const day = now.getDay();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    return { fromDate: start.getTime(), toDate: now.getTime() };
  }
  if (tf === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { fromDate: start.getTime(), toDate: now.getTime() };
  }
  if (tf === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { fromDate: start.getTime(), toDate: now.getTime() };
  }
  return {};
}

interface ChartBar {
  label: string;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

// ── Small inline SVG icons for the chart-type toggle ─────────────────────────
function BarIcon({ active, color }: { active: boolean; color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="7" width="3" height="6" rx="0.5" fill={color} opacity={active ? 1 : 0.45} />
      <rect x="5.5" y="4" width="3" height="9" rx="0.5" fill={color} opacity={active ? 1 : 0.45} />
      <rect x="10" y="1" width="3" height="12" rx="0.5" fill={color} opacity={active ? 1 : 0.45} />
    </svg>
  );
}
function LineIcon({ active, color }: { active: boolean; color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <polyline
        points="1,12 4,7 7,9 10,4 13,2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={active ? 1 : 0.45}
        fill="none"
      />
      {active && [
        [1, 12], [4, 7], [7, 9], [10, 4], [13, 2],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.5" fill={color} />
      ))}
    </svg>
  );
}

// ── Full-width SVG chart ──────────────────────────────────────────────────────
function UsageChart({
  bars,
  chartType,
  graphMetric,
  isDark,
  formatCost,
  formatTokens,
}: {
  bars: ChartBar[];
  chartType: ChartType;
  graphMetric: GraphMetric;
  isDark: boolean;
  formatCost: (n: number) => string;
  formatTokens: (n: number) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);

  // Measure real container width so bars genuinely fill the full card
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setW(Math.floor(w));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const H = 130;
  const PAD_TOP = 32;
  const PAD_BOTTOM = 20;
  const chartH = H - PAD_TOP - PAD_BOTTOM;

  const metricVal = (bar: ChartBar) => {
    switch (graphMetric) {
      case "input":    return bar.inputTokens;
      case "output":   return bar.outputTokens;
      case "cached":   return bar.cacheTokens;
      case "combined": return bar.tokens;
      default:         return bar.cost;
    }
  };
  const isCostMetric = graphMetric === "cost";

  const maxVal = useMemo(
    () => Math.max(...bars.map((b) => metricVal(b)), 0.000001),
    [bars, graphMetric]
  );

  const gap = bars.length > 40 ? 1 : bars.length > 20 ? 2 : 3;
  const barW =
    bars.length > 0
      ? Math.max(2, (W - gap * (bars.length - 1)) / bars.length)
      : 8;

  const accent = isDark ? "#60a5fa" : "#3b82f6";
  const accentHov = isDark ? "#93c5fd" : "#2563eb";
  const muted = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)";
  const labelCol = isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)";
  const ttBg = isDark ? "#1e293b" : "#f8fafc";
  const ttBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const ttText = isDark ? "#f1f5f9" : "#0f172a";
  const ttMuted = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const cacheCol = isDark ? "#34d399" : "#10b981";

  const showEvery =
    bars.length <= 12 ? 1 : bars.length <= 24 ? 2 : bars.length <= 60 ? 5 : 7;

  const pts = bars.map((bar, i) => {
    const val = metricVal(bar);
    const barH = Math.max(val > 0 ? 2 : 0, (val / maxVal) * chartH);
    const x = i * (barW + gap) + barW / 2;
    const y = PAD_TOP + chartH - barH;
    return { x, y, barH, val };
  });

  // Simple continuous line through all points (zeros hug the baseline — that's correct)
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath =
    pts.length > 0
      ? `${linePath} L ${pts[pts.length - 1].x} ${PAD_TOP + chartH} L ${pts[0].x} ${PAD_TOP + chartH} Z`
      : "";
  const isolatedDots: typeof pts = [];

  const gradId = `usageGrad-${isDark ? "d" : "l"}`;

  if (bars.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center text-xs w-full"
        style={{ height: H, color: labelCol }}
      >
        No data for this period
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ overflow: "visible", display: "block" }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={isDark ? 0.25 : 0.18} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Y-axis: 3 gridlines + labels (top, mid, baseline) */}
        {[
          { y: PAD_TOP,              value: maxVal },
          { y: PAD_TOP + chartH / 2, value: maxVal / 2 },
          { y: PAD_TOP + chartH,     value: 0 },
        ].map(({ y, value }, i) => {
          const label = isCostMetric
            ? (value === 0 ? "$0" : value < 0.01 ? "<$0.01" : value < 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`)
            : formatTokens(value);
          return (
            <g key={i}>
              <line x1={0} y1={y} x2={W} y2={y} stroke={muted} strokeWidth={1} />
              <text x={2} y={y - 3} textAnchor="start" fontSize={8} fill={labelCol}>
                {label}
              </text>
            </g>
          );
        })}


        {chartType === "bar" &&
          bars.map((bar, i) => {
            const { x, y, barH, val } = pts[i];
            const bx = x - barW / 2;
            const isHov = hovered === i;
            return (
              <g key={i}>
                <rect
                  x={bx}
                  y={y}
                  width={barW}
                  height={barH}
                  rx={Math.min(2, barW / 3)}
                  fill={isHov ? accentHov : accent}
                  opacity={val === 0 ? 0.12 : isHov ? 1 : 0.78}
                  style={{ transition: "opacity 0.1s, fill 0.1s" }}
                />
                {val === 0 && (
                  <rect
                    x={bx}
                    y={PAD_TOP + chartH - 2}
                    width={barW}
                    height={2}
                    rx={1}
                    fill={muted}
                  />
                )}
              </g>
            );
          })}

        {chartType === "line" && pts.length >= 2 && (
          <>
            {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke={accent}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {bars.map((bar, i) => {
              const { x, y, val } = pts[i];
              const isHov = hovered === i;
              if (!isHov && val === 0) return null;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={isHov ? 4 : 2.5}
                  fill={isHov ? accentHov : accent}
                  style={{ transition: "r 0.1s" }}
                />
              );
            })}
            {isolatedDots.map((p, i) => (
              <circle key={`iso-${i}`} cx={p.x} cy={p.y} r={4} fill={accent} />
            ))}
          </>
        )}

        {/* Shared hit areas + labels + tooltips */}
        {bars.map((bar, i) => {
          const { x, y } = pts[i];
          const bx = x - barW / 2;
          const isHov = hovered === i;
          const val = pts[i].val;

          const ttW = 130;
          const ttH = bar.cacheTokens > 0 ? 62 : 50;
          const ttX = Math.min(Math.max(x - ttW / 2, 0), W - ttW);
          const ttY = PAD_TOP - ttH - 6;

          const primaryLabel = isCostMetric
            ? formatCost(bar.cost)
            : formatTokens(val);
          const secondaryLabel = isCostMetric
            ? `${formatTokens(bar.tokens)} tokens`
            : formatCost(bar.cost);

          return (
            <g key={i}>
              {/* Hit area */}
              <rect
                x={bx - gap / 2}
                y={PAD_TOP}
                width={barW + gap}
                height={chartH + PAD_BOTTOM}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "default" }}
              />
              {/* X label */}
              {i % showEvery === 0 && (
                <text
                  x={x}
                  y={PAD_TOP + chartH + 13}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isHov ? (isDark ? "#94a3b8" : "#64748b") : labelCol}
                >
                  {bar.label}
                </text>
              )}
              {isHov && (
                <g>
                  <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={5} fill={ttBg} stroke={ttBorder} strokeWidth={1} />
                  <text x={ttX + 9} y={ttY + 16} fontSize={11} fontWeight="600" fill={ttText}>
                    {primaryLabel}
                  </text>
                  <text x={ttX + 9} y={ttY + 30} fontSize={9.5} fill={ttMuted}>
                    {secondaryLabel}
                  </text>
                  {bar.cacheTokens > 0 && (
                    <text x={ttX + 9} y={ttY + 44} fontSize={9.5} fill={cacheCol}>
                      {formatTokens(bar.cacheTokens)} cached
                    </text>
                  )}
                  <text x={ttX + 9} y={ttY + (bar.cacheTokens > 0 ? 56 : 42)} fontSize={9} fill={ttMuted}>
                    {bar.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Source filter dropdown ────────────────────────────────────────────────────
function SourceFilterDropdown({
  source,
  projectName,
  projectNames,
  onChange,
  t,
  isDark,
}: {
  source: FilterSource;
  projectName: string | null;
  projectNames: string[];
  onChange: (source: FilterSource, projectName: string | null) => void;
  t: any;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);

  const label =
    source === "all"
      ? "All sources"
      : source === "assistant"
      ? "Assistant"
      : projectName ?? "Projects";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary} ${t.colors.text} hover:opacity-80 transition-opacity`}
      >
        <span>{label}</span>
        <ChevronDown
          size={11}
          className={`${t.colors.textMuted} transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 top-full mt-1 w-48 ${t.colors.bg} border ${t.colors.border} ${t.borderRadius} shadow-xl z-20 overflow-hidden py-1`}
          >
            {/* All */}
            <button
              onClick={() => { onChange("all", null); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:opacity-70 transition-opacity ${
                source === "all" ? t.colors.text : t.colors.textMuted
              }`}
            >
              <span>All sources</span>
              {source === "all" && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              )}
            </button>

            {/* Projects section */}
            {projectNames.length > 0 && (
              <>
                <div className={`px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider ${t.colors.textMuted} opacity-60`}>
                  Projects
                </div>
                {projectNames.map((name) => {
                  const active = source === "project" && projectName === name;
                  return (
                    <button
                      key={name}
                      onClick={() => { onChange("project", name); setOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:opacity-70 transition-opacity ${
                        active ? t.colors.text : t.colors.textMuted
                      }`}
                    >
                      <ChevronRight size={10} className="opacity-40 flex-shrink-0" />
                      <span className="flex-1 truncate">{name}</span>
                      {active && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </>
            )}

            {/* Divider */}
            <div className={`mx-2 my-1 h-px ${t.colors.border}`} />

            {/* Assistant */}
            <button
              onClick={() => { onChange("assistant", null); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:opacity-70 transition-opacity ${
                source === "assistant" ? t.colors.text : t.colors.textMuted
              }`}
            >
              <span>Assistant</span>
              {source === "assistant" && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function UsageSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const {
    session,
    monthlyCost,
    monthlyInputCost,
    monthlyOutputCost,
    monthlyTokens,
    monthlyInputTokens,
    monthlyOutputTokens,
    allTimeCost,
    allTimeInputCost,
    allTimeOutputCost,
    allTimeTokens,
    allTimeInputTokens,
    allTimeOutputTokens,
    monthlyBudget,
    budgetAlertEnabled,
    budgetAlertThreshold,
    setMonthlyBudget,
    setBudgetAlertEnabled,
    setBudgetAlertThreshold,
    resetSession,
    clearAllData,
    sessionHistory,
    selectedSession,
    loadSessionHistory,
    loadSessionDetail,
    clearSelectedSession,
  } = useUsageStore();

  const [budgetInput, setBudgetInput] = useState(
    monthlyBudget !== null ? monthlyBudget.toString() : ""
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [dateFilter, setDateFilter] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("session");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [graphMetric, setGraphMetric] = useState<GraphMetric>("cost");
  const [rangeHistory, setRangeHistory] = useState<SessionSummary[]>([]);

  // ── Source filter state ───────────────────────────────────────────────────
  const [filterSource, setFilterSource] = useState<FilterSource>("all");
  const [filterProjectName, setFilterProjectName] = useState<string | null>(null);
  const [projectNames, setProjectNames] = useState<string[]>([]);

  // Single filtered-stats state — reloads whenever filter OR timeframe changes.
  // Covers every tab so the displayed numbers always match the active filter.
  const [filteredStats, setFilteredStats] = useState<{
    cost: number; inputCost: number; outputCost: number;
    tokens: number; inputTokens: number; outputTokens: number;
  } | null>(null);

  // Read project names from projectStore (already loaded at app start).
  // Falls back to a DB query if the store is empty (first run / HMR).
  const storeProjects = useProjectStore((s) => s.projects);
  useEffect(() => {
    if (storeProjects.length > 0) {
      setProjectNames(storeProjects.map((p) => p.name));
    } else {
      dbService.getProjects()
        .then((projects) => setProjectNames(projects.map((p) => p.name)))
        .catch(() => {});
    }
  }, [storeProjects]);

  // When assistant filter is active and session tab is selected, switch to today.
  // Session is always in-memory and has no source breakdown.
  useEffect(() => {
    if (filterSource === "assistant" && timeframe === "session") {
      setTimeframe("today");
    }
  }, [filterSource]);

  // Reload filtered DB stats whenever the filter or the timeframe changes.
  // Not needed for "all sources" or the session tab (in-memory only).
  useEffect(() => {
    if (filterSource === "all" || timeframe === "session") {
      setFilteredStats(null);
      return;
    }

    const dbFilter =
      filterSource === "assistant"
        ? { source: "assistant" as const }
        : { source: "project" as const, projectName: filterProjectName ?? undefined };

    const range = timeframe === "alltime" ? {} : getDateRange(timeframe);

    dbService.getUsageInRange({ ...range, filter: dbFilter })
      .then((s) => setFilteredStats({
        cost: s.cost, inputCost: s.inputCost, outputCost: s.outputCost,
        tokens: s.tokens, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
      }))
      .catch(() => {});
  }, [filterSource, filterProjectName, timeframe]);

  const handleFilterChange = (src: FilterSource, proj: string | null) => {
    setFilterSource(src);
    setFilterProjectName(proj);
  };

  // History panel (date-filter driven)
  useEffect(() => {
    const options: { fromDate?: number; toDate?: number } = {};
    if (dateFilter) {
      const d = new Date(dateFilter);
      options.fromDate = d.getTime();
      options.toDate = d.getTime() + 86400000;
    }
    loadSessionHistory(options);
  }, [dateFilter, loadSessionHistory]);

  // Range data for stats + chart
  useEffect(() => {
    if (timeframe === "session" || timeframe === "month" || timeframe === "alltime") {
      setRangeHistory([]);
      return;
    }
    loadSessionHistory(getDateRange(timeframe));
  }, [timeframe, loadSessionHistory]);

  useEffect(() => {
    if (timeframe !== "today" && timeframe !== "week" && timeframe !== "year") return;
    setRangeHistory(sessionHistory);
  }, [sessionHistory, timeframe]);

  // ── Does the live session fall inside the current timeframe? ──────────────
  // The session is always "now", so it overlaps every range that includes today.
  const sessionInRange = useMemo(() => {
    if (timeframe === "session") return false; // session tab handles it directly
    if (timeframe === "alltime") return true;
    if (!session.entries.length) return false;
    const range = getDateRange(timeframe);
    const sessionStart = session.entries[0].timestamp;
    const from = range.fromDate ?? 0;
    const to = range.toDate ?? Infinity;
    return sessionStart >= from && sessionStart <= to;
  }, [timeframe, session.entries]);

  // ── Session cache totals (from entries) ────────────────────────────────────
  const sessionCacheReadTokens = useMemo(
    () => session.entries.reduce((s, e) => s + (e.cacheReadTokens ?? 0), 0),
    [session.entries]
  );
  const sessionCacheCreationTokens = useMemo(
    () => session.entries.reduce((s, e) => s + (e.cacheCreationTokens ?? 0), 0),
    [session.entries]
  );

  // ── Chart buckets ──────────────────────────────────────────────────────────
  const chartBars = useMemo((): ChartBar[] => {
    const now = new Date();

    if (timeframe === "session") {
      return session.entries.map((e) => ({
        label: new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        cost: e.cost,
        tokens: e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0),
        inputTokens: e.inputTokens ?? 0,
        outputTokens: e.outputTokens ?? 0,
        cacheTokens: (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0),
      }));
    }

    if (timeframe === "today") {
      const buckets = Array.from({ length: 24 }, (_, h) => ({
        label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
        cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0,
      }));
      rangeHistory.forEach((s) => {
        const h = new Date(s.startTime).getHours();
        buckets[h].cost += s.totalCost;
        buckets[h].tokens += s.totalTokens;
        buckets[h].inputTokens += s.totalInputTokens ?? 0;
        buckets[h].outputTokens += s.totalOutputTokens ?? 0;
        buckets[h].cacheTokens += (s as any).totalCacheReadTokens ?? 0;
      });
      if (sessionInRange) {
        session.entries.forEach((e) => {
          const h = new Date(e.timestamp).getHours();
          buckets[h].cost += e.cost;
          buckets[h].tokens += e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
          buckets[h].inputTokens += e.inputTokens ?? 0;
          buckets[h].outputTokens += e.outputTokens ?? 0;
          buckets[h].cacheTokens += (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0);
        });
      }
      return buckets;
    }

    if (timeframe === "week") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const todayDow = now.getDay();
      const buckets = days.map((label) => ({ label, cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 }));
      rangeHistory.forEach((s) => {
        const dow = new Date(s.startTime).getDay();
        buckets[dow].cost += s.totalCost;
        buckets[dow].tokens += s.totalTokens;
        buckets[dow].inputTokens += s.totalInputTokens ?? 0;
        buckets[dow].outputTokens += s.totalOutputTokens ?? 0;
        buckets[dow].cacheTokens += (s as any).totalCacheReadTokens ?? 0;
      });
      if (sessionInRange) {
        session.entries.forEach((e) => {
          const dow = new Date(e.timestamp).getDay();
          buckets[dow].cost += e.cost;
          buckets[dow].tokens += e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
          buckets[dow].inputTokens += e.inputTokens ?? 0;
          buckets[dow].outputTokens += e.outputTokens ?? 0;
          buckets[dow].cacheTokens += (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0);
        });
      }
      return [...buckets.slice(todayDow + 1), ...buckets.slice(0, todayDow + 1)];
    }

    if (timeframe === "month") {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const buckets = Array.from({ length: daysInMonth }, (_, i) => ({
        label: `${i + 1}`, cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0,
      }));
      rangeHistory.forEach((s) => {
        const day = new Date(s.startTime).getDate() - 1;
        if (day >= 0 && day < daysInMonth) {
          buckets[day].cost += s.totalCost;
          buckets[day].tokens += s.totalTokens;
          buckets[day].inputTokens += s.totalInputTokens ?? 0;
          buckets[day].outputTokens += s.totalOutputTokens ?? 0;
          buckets[day].cacheTokens += (s as any).totalCacheReadTokens ?? 0;
        }
      });
      if (sessionInRange) {
        session.entries.forEach((e) => {
          const day = new Date(e.timestamp).getDate() - 1;
          if (day >= 0 && day < daysInMonth) {
            buckets[day].cost += e.cost;
            buckets[day].tokens += e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
            buckets[day].inputTokens += e.inputTokens ?? 0;
            buckets[day].outputTokens += e.outputTokens ?? 0;
            buckets[day].cacheTokens += (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0);
          }
        });
      }
      return buckets;
    }

    if (timeframe === "year") {
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const buckets = monthNames.map((label) => ({ label, cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 }));
      rangeHistory.forEach((s) => {
        const m = new Date(s.startTime).getMonth();
        buckets[m].cost += s.totalCost;
        buckets[m].tokens += s.totalTokens;
        buckets[m].inputTokens += s.totalInputTokens ?? 0;
        buckets[m].outputTokens += s.totalOutputTokens ?? 0;
        buckets[m].cacheTokens += (s as any).totalCacheReadTokens ?? 0;
      });
      if (sessionInRange) {
        session.entries.forEach((e) => {
          const m = new Date(e.timestamp).getMonth();
          buckets[m].cost += e.cost;
          buckets[m].tokens += e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
          buckets[m].inputTokens += e.inputTokens ?? 0;
          buckets[m].outputTokens += e.outputTokens ?? 0;
          buckets[m].cacheTokens += (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0);
        });
      }
      return buckets;
    }

    if (timeframe === "alltime") {
      const map = new Map<string, { cost: number; tokens: number; inputTokens: number; outputTokens: number; cacheTokens: number }>();
      sessionHistory.forEach((s) => {
        const d = new Date(s.startTime);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const prev = map.get(key) ?? { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
        map.set(key, {
          cost: prev.cost + s.totalCost,
          tokens: prev.tokens + s.totalTokens,
          inputTokens: prev.inputTokens + (s.totalInputTokens ?? 0),
          outputTokens: prev.outputTokens + (s.totalOutputTokens ?? 0),
          cacheTokens: prev.cacheTokens + ((s as any).totalCacheReadTokens ?? 0),
        });
      });
      session.entries.forEach((e) => {
        const d = new Date(e.timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const prev = map.get(key) ?? { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
        map.set(key, {
          cost: prev.cost + e.cost,
          tokens: prev.tokens + (e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0)),
          inputTokens: prev.inputTokens + (e.inputTokens ?? 0),
          outputTokens: prev.outputTokens + (e.outputTokens ?? 0),
          cacheTokens: prev.cacheTokens + (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0),
        });
      });
      const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
      const PAD = 3;
      const addMonths = (key: string, delta: number) => {
        const [y, m] = key.split("-").map(Number);
        const d = new Date(y, m - 1 + delta);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      };
      const makeLabel = (key: string) => {
        const [year, month] = key.split("-");
        return new Date(parseInt(year), parseInt(month) - 1)
          .toLocaleString("default", { month: "short" }) + ` '${year.slice(2)}`;
      };
      const empty = { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
      const firstKey = sorted[0]?.[0];
      const lastKey = sorted[sorted.length - 1]?.[0];
      const prefix = firstKey
        ? Array.from({ length: PAD }, (_, i) => [addMonths(firstKey, -(PAD - i)), empty] as [string, typeof empty])
        : [];
      const suffix = lastKey
        ? Array.from({ length: PAD }, (_, i) => [addMonths(lastKey, i + 1), empty] as [string, typeof empty])
        : [];
      return [...prefix, ...sorted, ...suffix].map(([key, val]) => ({ label: makeLabel(key), ...val }));
    }

    return [];
  }, [timeframe, session.entries, rangeHistory, sessionHistory]);

  // ── Aggregated stats ───────────────────────────────────────────────────────
  const rangeStats = useMemo(() => {
    const base = rangeHistory.reduce(
      (acc, s) => ({
        cost: acc.cost + s.totalCost,
        inputCost: acc.inputCost + (s.totalInputCost ?? 0),
        outputCost: acc.outputCost + (s.totalOutputCost ?? 0),
        tokens: acc.tokens + s.totalTokens,
        inputTokens: acc.inputTokens + (s.totalInputTokens ?? 0),
        outputTokens: acc.outputTokens + (s.totalOutputTokens ?? 0),
        cacheReadTokens: acc.cacheReadTokens + ((s as any).totalCacheReadTokens ?? 0),
        cacheCreationTokens: acc.cacheCreationTokens + ((s as any).totalCacheCreationTokens ?? 0),
        calls: acc.calls + s.entryCount,
      }),
      {
        cost: 0, inputCost: 0, outputCost: 0,
        tokens: 0, inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheCreationTokens: 0,
        calls: 0,
      }
    );
    // Merge live (unsaved) session data when the session falls inside this range
    if (sessionInRange) {
      base.cost += session.totalCost;
      base.inputCost += session.totalInputCost ?? 0;
      base.outputCost += session.totalOutputCost ?? 0;
      base.tokens += session.totalTokens;
      base.inputTokens += session.totalInputTokens ?? 0;
      base.outputTokens += session.totalOutputTokens ?? 0;
      base.cacheReadTokens += sessionCacheReadTokens;
      base.cacheCreationTokens += sessionCacheCreationTokens;
      base.calls += session.entries.length;
    }
    return base;
  }, [
    rangeHistory, sessionInRange,
    session, sessionCacheReadTokens, sessionCacheCreationTokens,
  ]);

  const stats = useMemo(() => {
    // When a source filter is active and we have filtered DB data, use it for
    // every tab except session (session is in-memory with no source breakdown).
    if (filterSource !== "all" && filteredStats && timeframe !== "session") {
      return {
        cost: filteredStats.cost,
        inputCost: filteredStats.inputCost,
        outputCost: filteredStats.outputCost,
        tokens: filteredStats.tokens,
        inputTokens: filteredStats.inputTokens,
        outputTokens: filteredStats.outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: null,
      };
    }

    switch (timeframe) {
      case "session":
        return {
          cost: session.totalCost,
          inputCost: session.totalInputCost ?? 0,
          outputCost: session.totalOutputCost ?? 0,
          tokens: session.totalTokens,
          inputTokens: session.totalInputTokens ?? 0,
          outputTokens: session.totalOutputTokens ?? 0,
          cacheReadTokens: sessionCacheReadTokens,
          cacheCreationTokens: sessionCacheCreationTokens,
          calls: session.entries.length,
        };
      case "month": {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const historyCacheRead = sessionHistory
          .filter((s) => s.startTime >= monthStart)
          .reduce((sum, s) => sum + ((s as any).totalCacheReadTokens ?? 0), 0);
        const historyCacheCreate = sessionHistory
          .filter((s) => s.startTime >= monthStart)
          .reduce((sum, s) => sum + ((s as any).totalCacheCreationTokens ?? 0), 0);
        return {
          cost: monthlyCost + session.totalCost,
          inputCost: (monthlyInputCost ?? 0) + (session.totalInputCost ?? 0),
          outputCost: (monthlyOutputCost ?? 0) + (session.totalOutputCost ?? 0),
          tokens: monthlyTokens + session.totalTokens,
          inputTokens: (monthlyInputTokens ?? 0) + (session.totalInputTokens ?? 0),
          outputTokens: (monthlyOutputTokens ?? 0) + (session.totalOutputTokens ?? 0),
          cacheReadTokens: historyCacheRead + sessionCacheReadTokens,
          cacheCreationTokens: historyCacheCreate + sessionCacheCreationTokens,
          calls: null,
        };
      }
      case "alltime": {
        const historyCacheRead = sessionHistory
          .reduce((sum, s) => sum + ((s as any).totalCacheReadTokens ?? 0), 0);
        const historyCacheCreate = sessionHistory
          .reduce((sum, s) => sum + ((s as any).totalCacheCreationTokens ?? 0), 0);
        return {
          cost: allTimeCost + session.totalCost,
          inputCost: (allTimeInputCost ?? 0) + (session.totalInputCost ?? 0),
          outputCost: (allTimeOutputCost ?? 0) + (session.totalOutputCost ?? 0),
          tokens: allTimeTokens + session.totalTokens,
          inputTokens: (allTimeInputTokens ?? 0) + (session.totalInputTokens ?? 0),
          outputTokens: (allTimeOutputTokens ?? 0) + (session.totalOutputTokens ?? 0),
          cacheReadTokens: historyCacheRead + sessionCacheReadTokens,
          cacheCreationTokens: historyCacheCreate + sessionCacheCreationTokens,
          calls: null,
        };
      }
      default:
        return { ...rangeStats, calls: rangeStats.calls };
    }
  }, [
    timeframe, session, sessionCacheReadTokens, sessionCacheCreationTokens,
    monthlyCost, monthlyInputCost, monthlyOutputCost,
    monthlyTokens, monthlyInputTokens, monthlyOutputTokens,
    allTimeCost, allTimeInputCost, allTimeOutputCost,
    allTimeTokens, allTimeInputTokens, allTimeOutputTokens,
    rangeStats, sessionHistory,
    filterSource, filteredStats,
  ]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatCost = (cost: number) => {
    if (cost < 0.01) return "<$0.01";
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const formatDuration = (startMs: number, endMs: number) => {
    const mins = Math.round((endMs - startMs) / 60000);
    if (mins < 1) return "<1 min";
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  };

  const budgetPercent =
    monthlyBudget && monthlyBudget > 0
      ? Math.min((monthlyCost / monthlyBudget) * 100, 100)
      : 0;

  const budgetColor =
    budgetPercent >= 100 ? "bg-red-500" : budgetPercent >= 80 ? "bg-amber-500" : "bg-green-500";

  const handleBudgetSave = () => {
    const val = parseFloat(budgetInput);
    if (!budgetInput || isNaN(val) || val <= 0) setMonthlyBudget(null);
    else setMonthlyBudget(val);
  };

  const isDark = theme !== "light";
  // Hide Session tab for assistant filter — session is in-memory with no source breakdown.
  const timeframes: Timeframe[] = filterSource === "assistant"
    ? ["today", "week", "month", "year", "alltime"]
    : ["session", "today", "week", "month", "year", "alltime"];

  // Colors for the chart-toggle icons
  const iconColor = isDark ? "#94a3b8" : "#64748b";
  const iconColorActive = isDark ? "#f1f5f9" : "#0f172a";

  const hasCacheData =
    stats.cacheReadTokens > 0 || stats.cacheCreationTokens > 0;

  // Filter is only meaningful for month/alltime tabs; hide chart note on session/range tabs
  const filterActive = filterSource !== "all";
  const filterLabel =
    filterSource === "assistant"
      ? "Assistant"
      : filterProjectName ?? "Projects";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className={`text-lg font-semibold ${t.colors.text}`}>Usage & Costs</h2>
        <p className={`text-sm ${t.colors.textMuted} mt-1 mb-3`}>
          Track your API token usage and costs. All data stored locally on your device.
        </p>
        <SourceFilterDropdown
          source={filterSource}
          projectName={filterProjectName}
          projectNames={projectNames}
          onChange={handleFilterChange}
          t={t}
          isDark={isDark}
        />
      </div>

      {/* ── Timeframe tabs ───────────────────────────────────────────────────── */}
      <div className={`flex border-b ${t.colors.border}`}>
        {timeframes.map((tf) => {
          const isActive = timeframe === tf;
          return (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`
                relative flex-1 py-2 text-xs font-medium transition-colors duration-150
                ${isActive
                  ? `${t.colors.text}`
                  : `${t.colors.textMuted} hover:${t.colors.text}`
                }
              `}
            >
              {TIMEFRAME_LABELS[tf]}
              {/* Active indicator bar */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                  style={{ marginBottom: "-1px" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Stats card + Chart ──────────────────────────────────────────────── */}
      <div className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}>
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${t.colors.textMuted}`}>
              {TIMEFRAME_LABELS[timeframe]}
            </span>
            {/* Show active filter badge when on month/alltime */}
            {filterActive && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{
                  background: filterSource === "assistant"
                    ? "rgba(45,184,122,0.12)"
                    : "rgba(99,102,241,0.12)",
                  color: filterSource === "assistant" ? "#2DB87A" : "#818cf8",
                }}
              >
                {filterLabel}
              </span>
            )}
          </div>
          {stats.calls !== null && (
            <span className={`text-xs ${t.colors.textMuted}`}>
              {stats.calls} {stats.calls === 1 ? "call" : "calls"}
            </span>
          )}
        </div>

        {/* Big cost number */}
        <div className={`text-3xl font-bold ${t.colors.text} mb-1`}>
          {formatCost(stats.cost)}
        </div>
        <div className={`text-sm ${t.colors.textMuted} mb-4`}>
          {formatTokens(stats.tokens)} tokens
        </div>

        {/* Token breakdown — Input / Output / Cached */}
        <div
          className={`pt-3 border-t ${t.colors.border} mb-5`}
          style={{
            display: "grid",
            gridTemplateColumns: hasCacheData ? "1fr 1fr 1fr" : "1fr 1fr",
            gap: "12px",
          }}
        >
          <div>
            <div className={`text-xs ${t.colors.textMuted} mb-0.5`}>Input</div>
            <div className={`text-sm font-medium ${t.colors.text}`}>
              {formatTokens(stats.inputTokens)}
            </div>
            <div className={`text-xs ${t.colors.textMuted}`}>{formatCost(stats.inputCost)}</div>
          </div>
          <div>
            <div className={`text-xs ${t.colors.textMuted} mb-0.5`}>Output</div>
            <div className={`text-sm font-medium ${t.colors.text}`}>
              {formatTokens(stats.outputTokens)}
            </div>
            <div className={`text-xs ${t.colors.textMuted}`}>{formatCost(stats.outputCost)}</div>
          </div>
          {hasCacheData && (
            <div>
              <div className="text-xs text-emerald-500 mb-0.5">Cached</div>
              <div className="text-sm font-medium text-emerald-500">
                {formatTokens(stats.cacheReadTokens)}
              </div>
              {stats.cacheCreationTokens > 0 && (
                <div className={`text-xs ${t.colors.textMuted}`}>
                  +{formatTokens(stats.cacheCreationTokens)} written
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chart header row: label + bar/line toggle */}
        <div className={`pt-4 border-t ${t.colors.border}`}>
          <div className="flex items-center justify-between mb-3">
            {/* Metric pills */}
            <div className={`flex items-center gap-1 p-0.5 ${t.borderRadius} border ${t.colors.border}`}>
              {([
                { key: "cost",     label: "Cost" },
                { key: "combined", label: "Combined" },
                { key: "input",    label: "Input" },
                { key: "output",   label: "Output" },
                { key: "cached",   label: "Cached" },
              ] as { key: GraphMetric; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setGraphMetric(key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-all duration-150 ${
                    graphMetric === key
                      ? `${t.colors.bgPrimary} ${t.colors.text}`
                      : `${t.colors.textMuted} hover:opacity-80`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Bar / Line toggle */}
            <div className={`flex items-center gap-0.5 p-0.5 ${t.borderRadius} border ${t.colors.border}`}>
              <button
                onClick={() => setChartType("bar")}
                className={`p-1 rounded transition-colors ${chartType === "bar" ? t.colors.bgPrimary : "hover:opacity-70"}`}
                title="Bar chart"
              >
                <BarIcon active={chartType === "bar"} color={chartType === "bar" ? iconColorActive : iconColor} />
              </button>
              <button
                onClick={() => setChartType("line")}
                className={`p-1 rounded transition-colors ${chartType === "line" ? t.colors.bgPrimary : "hover:opacity-70"}`}
                title="Line chart"
              >
                <LineIcon active={chartType === "line"} color={chartType === "line" ? iconColorActive : iconColor} />
              </button>
            </div>
          </div>

          <UsageChart
            bars={chartBars}
            chartType={chartType}
            graphMetric={graphMetric}
            isDark={isDark}
            formatCost={formatCost}
            formatTokens={formatTokens}
          />
        </div>
      </div>

      {/* ── Budget Section ──────────────────────────────────────────────────── */}
      <div className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}>
        <span className={`text-sm font-semibold ${t.colors.text}`}>Monthly Budget</span>

        <div className="flex items-center gap-3 mt-3 mb-3">
          <div className="flex items-center gap-1">
            <span className={`text-sm ${t.colors.textMuted}`}>$</span>
            <input
              type="number"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onBlur={handleBudgetSave}
              onKeyDown={(e) => e.key === "Enter" && handleBudgetSave()}
              placeholder="No limit"
              className={`w-24 px-2 py-1 text-sm ${t.borderRadius} border ${t.colors.border} ${t.colors.bgPrimary} ${t.colors.text} placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500`}
              style={{ colorScheme: isDark ? "dark" : "light" }}
              min="0"
              step="1"
            />
          </div>
          <span className={`text-xs ${t.colors.textMuted}`}>per month</span>
        </div>

        {monthlyBudget !== null && monthlyBudget > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className={t.colors.textMuted}>
                {formatCost(monthlyCost)} / ${monthlyBudget.toFixed(0)}
              </span>
              <span className={t.colors.textMuted}>{budgetPercent.toFixed(0)}%</span>
            </div>
            <div className={`w-full h-2 ${t.borderRadius} ${t.colors.bgPrimary} overflow-hidden`}>
              <div
                className={`h-full ${budgetColor} transition-all duration-300`}
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
            {budgetPercent >= 80 && (
              <p className="text-xs text-amber-500 mt-2">
                {budgetPercent >= 100
                  ? "Budget exceeded!"
                  : `Approaching budget limit (${budgetPercent.toFixed(0)}%)`}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={budgetAlertEnabled}
              onChange={(e) => setBudgetAlertEnabled(e.target.checked)}
              className="accent-blue-500"
            />
            <span className={`text-sm ${t.colors.text}`}>Budget alerts</span>
          </label>
          {budgetAlertEnabled && (
            <div className="flex items-center gap-1">
              <span className={`text-xs ${t.colors.textMuted}`}>Alert at</span>
              <select
                value={budgetAlertThreshold}
                onChange={(e) => setBudgetAlertThreshold(parseInt(e.target.value))}
                className={`text-xs px-1 py-0.5 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgPrimary} ${t.colors.text}`}
                style={{ colorScheme: isDark ? "dark" : "light" }}
              >
                <option value={50}>50%</option>
                <option value={75}>75%</option>
                <option value={80}>80%</option>
                <option value={90}>90%</option>
                <option value={100}>100%</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Session API Calls ────────────────────────────────────────── */}
      {session.entries.length > 0 && (
        <div className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}>
          <span className={`text-sm font-semibold ${t.colors.text}`}>Session API Calls</span>
          <div className="space-y-2 mt-3 max-h-48 overflow-y-auto">
            {[...session.entries].reverse().map((entry) => (
              <div
                key={entry.id}
                className={`flex items-center justify-between text-xs px-2 py-1.5 ${t.borderRadius} ${t.colors.bgPrimary}`}
              >
                <div className={`flex items-center gap-2 min-w-0 ${t.colors.text}`}>
                  <span className={`font-mono shrink-0 ${t.colors.textMuted}`}>
                    {formatTime(entry.timestamp)}
                  </span>
                  <span className="font-mono truncate">
                    {entry.model.split("-").slice(0, 2).join(" ")}
                  </span>
                  <span className={`shrink-0 ${t.colors.textMuted}`}>
                    {formatTokens(entry.inputTokens)} in · {formatTokens(entry.outputTokens)} out
                  </span>
                  {(entry.cacheReadTokens ?? 0) > 0 && (
                    <span className="text-emerald-500 shrink-0" title="Tokens served from cache">
                      {formatTokens(entry.cacheReadTokens)} cached
                    </span>
                  )}
                </div>
                <span className="font-medium shrink-0 ml-2">{formatCost(entry.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Session History ─────────────────────────────────────────────────── */}
      <div className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-sm font-semibold ${t.colors.text}`}>Session History</span>
          {selectedSession && (
            <button
              onClick={clearSelectedSession}
              className={`text-xs px-2 py-1 ${t.borderRadius} border ${t.colors.border} ${t.colors.text} hover:opacity-80 transition-opacity`}
            >
              Back to list
            </button>
          )}
        </div>

        {!selectedSession && (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className={`text-xs px-2 py-1 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgPrimary} ${t.colors.text} outline-none`}
              style={{ colorScheme: isDark ? "dark" : "light" }}
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter("")}
                className={`text-xs ${t.colors.textMuted} hover:opacity-80`}
              >
                Clear filter
              </button>
            )}
          </div>
        )}

        {selectedSession && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className={`text-xs ${t.colors.textMuted}`}>Duration</div>
                <div className={`text-sm font-medium ${t.colors.text}`}>
                  {formatDuration(selectedSession.summary.startTime, selectedSession.summary.endTime)}
                </div>
              </div>
              <div>
                <div className={`text-xs ${t.colors.textMuted}`}>Total cost</div>
                <div className={`text-sm font-medium ${t.colors.text}`}>
                  {formatCost(selectedSession.summary.totalCost)}
                </div>
              </div>
              <div>
                <div className={`text-xs ${t.colors.textMuted}`}>Tokens</div>
                <div className={`text-sm font-medium ${t.colors.text}`}>
                  {formatTokens(selectedSession.summary.totalTokens)}
                </div>
              </div>
            </div>

            <div className={`pt-2 border-t ${t.colors.border} space-y-1`}>
              <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
                <span>Input</span>
                <span>
                  {formatTokens(selectedSession.summary.totalInputTokens)} ·{" "}
                  {formatCost(selectedSession.summary.totalInputCost)}
                </span>
              </div>
              <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
                <span>Output</span>
                <span>
                  {formatTokens(selectedSession.summary.totalOutputTokens)} ·{" "}
                  {formatCost(selectedSession.summary.totalOutputCost)}
                </span>
              </div>
            </div>

            {selectedSession.summary.models.length > 0 && (
              <div className={`text-xs ${t.colors.textMuted}`}>
                Models: {selectedSession.summary.models.join(", ")}
              </div>
            )}

            <div className={`text-xs font-medium ${t.colors.text} pt-1`}>
              API Calls ({selectedSession.entries.length})
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {selectedSession.entries.map((entry, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between text-xs px-2 py-1.5 ${t.borderRadius} ${t.colors.bgPrimary}`}
                >
                  <div className={`flex items-center gap-2 min-w-0 ${t.colors.text}`}>
                    <span className={`font-mono shrink-0 ${t.colors.textMuted}`}>
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className="font-mono truncate">
                      {entry.model.split("-").slice(0, 2).join(" ")}
                    </span>
                    <span className={`shrink-0 ${t.colors.textMuted}`}>
                      {formatTokens(entry.inputTokens)} in · {formatTokens(entry.outputTokens)} out
                    </span>
                    {entry.cacheReadTokens > 0 && (
                      <span className="text-emerald-500 shrink-0" title="Tokens served from cache">
                        ({formatTokens(entry.cacheReadTokens)} cached)
                      </span>
                    )}
                  </div>
                  <span className="font-medium shrink-0 ml-2">{formatCost(entry.cost)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!selectedSession && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {sessionHistory.length === 0 ? (
              <p className={`text-xs ${t.colors.textMuted}`}>
                {dateFilter ? "No sessions found for this date." : "No usage data recorded yet."}
              </p>
            ) : (
              sessionHistory.map((s: SessionSummary) => (
                <button
                  key={s.id}
                  onClick={() => loadSessionDetail(s.id)}
                  className={`w-full text-left flex items-center justify-between text-xs px-3 py-2.5 ${t.borderRadius} ${t.colors.bgPrimary} hover:opacity-80 transition-opacity`}
                >
                  <div className="space-y-0.5">
                    <div className={`font-medium ${t.colors.text}`}>
                      {formatDate(s.startTime)}
                      {!s.id.startsWith("date_") && (
                        <span className={`ml-1.5 font-normal ${t.colors.textMuted}`}>
                          {formatTime(s.startTime)} – {formatTime(s.endTime)}
                        </span>
                      )}
                    </div>
                    <div className={t.colors.textMuted}>
                      {s.entryCount} {s.entryCount === 1 ? "call" : "calls"}
                      {s.id.startsWith("date_") && " (before session tracking)"}
                      {s.models.length > 0 && ` · ${s.models[0]}`}
                      {s.models.length > 1 && ` +${s.models.length - 1}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className={`font-medium ${t.colors.text}`}>{formatCost(s.totalCost)}</div>
                    <div className={t.colors.textMuted}>{formatTokens(s.totalTokens)}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={resetSession}
          className={`px-3 py-1.5 text-sm ${t.borderRadius} border ${t.colors.border} ${t.colors.text} hover:opacity-80 transition-opacity`}
        >
          Reset Session
        </button>

        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            className={`px-3 py-1.5 text-sm ${t.borderRadius} border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors`}
          >
            Clear All Data
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-500">Are you sure?</span>
            <button
              onClick={() => { clearAllData(); setShowClearConfirm(false); setBudgetInput(""); }}
              className={`px-3 py-1.5 text-sm ${t.borderRadius} bg-red-500 text-white hover:bg-red-600 transition-colors`}
            >
              Yes, clear
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className={`px-3 py-1.5 text-sm ${t.borderRadius} border ${t.colors.border} ${t.colors.text} hover:opacity-80`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <p className={`text-xs ${t.colors.textMuted}`}>
        All usage data is stored locally on your device. Nothing is sent to our servers.
      </p>
    </div>
  );
}

export default UsageSettings;