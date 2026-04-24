import { useState, useMemo } from "react";
import { Coins, ChevronDown, ChevronUp, Zap, Sun, Calendar, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useUsageStore } from "../../stores/usageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

type Timeframe = "session" | "today" | "month";

function UsageIndicator() {
  const [expanded, setExpanded] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("session");
  const { theme } = useSettingsStore();
  const {
    session,
    todayTokens, todayInputTokens, todayOutputTokens, todayInputCost, todayOutputCost,
    todayCacheReadTokens, todayCacheCreationTokens,
    monthlyTokens, monthlyCost, monthlyInputTokens, monthlyOutputTokens, monthlyInputCost, monthlyOutputCost,
    monthlyCacheReadTokens, monthlyCacheCreationTokens,
  } = useUsageStore();
  const t = themes[theme];

  const formatCost = (cost: number) => {
    if (cost <= 0) return "$0.00";
    if (cost < 0.01) return "<$0.01";
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  };

  // Compute cache tokens from session entries
  const sessionCacheRead = useMemo(
    () => session.entries.reduce((sum, e) => sum + (e.cacheReadTokens ?? 0), 0),
    [session.entries]
  );
  const sessionCacheCreation = useMemo(
    () => session.entries.reduce((sum, e) => sum + (e.cacheCreationTokens ?? 0), 0),
    [session.entries]
  );

  const getData = () => {
    switch (timeframe) {
      case "session": {
        const inputCost = session.totalInputCost;
        const outputCost = session.totalOutputCost;
        return {
          totalTokens: session.totalTokens,
          totalCost: inputCost + outputCost,
          inputTokens: session.totalInputTokens,
          outputTokens: session.totalOutputTokens,
          inputCost,
          outputCost,
          cacheReadTokens: sessionCacheRead,
          cacheCreationTokens: sessionCacheCreation,
          callCount: session.entries.length,
        };
      }
      case "today": {
        const inputCost = todayInputCost + session.totalInputCost;
        const outputCost = todayOutputCost + session.totalOutputCost;
        return {
          totalTokens: todayTokens + session.totalTokens,
          totalCost: inputCost + outputCost,
          inputTokens: todayInputTokens + session.totalInputTokens,
          outputTokens: todayOutputTokens + session.totalOutputTokens,
          inputCost,
          outputCost,
          cacheReadTokens: todayCacheReadTokens + sessionCacheRead,
          cacheCreationTokens: todayCacheCreationTokens + sessionCacheCreation,
          callCount: null,
        };
      }
      case "month":
      default:
        return {
          totalTokens: monthlyTokens,
          totalCost: monthlyCost,
          inputTokens: monthlyInputTokens,
          outputTokens: monthlyOutputTokens,
          inputCost: monthlyInputCost,
          outputCost: monthlyOutputCost,
          cacheReadTokens: monthlyCacheReadTokens,
          cacheCreationTokens: monthlyCacheCreationTokens,
          callCount: null,
        };
    }
  };

  const data = getData();
  const totalCached = data.cacheReadTokens + data.cacheCreationTokens;

  // Derive the topbar button cost from input+output so it always matches the dropdown
  const sessionDisplayCost = session.totalInputCost + session.totalOutputCost;

  const tabBase = `px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer`;
  const tabActive = theme === "light"
    ? "bg-blue-500 text-white"
    : theme === "sepia"
    ? "bg-orange-700 text-orange-100"
    : theme === "retro"
    ? "bg-green-700 text-black"
    : theme === "midnight"
    ? "bg-indigo-600 text-white"
    : theme === "highContrast"
    ? "bg-white text-black"
    : "bg-blue-600 text-white";
  const tabInactive = `${t.colors.textMuted} hover:opacity-80`;

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 px-4 py-2 ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} text-sm hover:bg-white/20 transition-colors`}
        title="API usage this session"
      >
        <Coins size={16} className="text-amber-500" />
        <span className="font-medium">
          {formatCost(sessionDisplayCost)}
        </span>
        {expanded ? (
          <ChevronUp size={14} className={t.colors.textMuted} />
        ) : (
          <ChevronDown size={14} className={t.colors.textMuted} />
        )}
      </button>

      {expanded && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setExpanded(false)}
          />

          <div
            className={`absolute right-0 top-full mt-2 w-72 ${t.colors.bgSecondary} ${t.borderRadius} shadow-xl border ${t.colors.border} z-50 overflow-hidden`}
          >
            <div className={`px-3 py-2 border-b ${t.colors.border} ${t.colors.bgTertiary}`}>
              <h3 className={`text-sm font-semibold ${t.colors.text}`}>API Usage</h3>
            </div>

            <div className={`flex gap-1 px-3 py-2 border-b ${t.colors.border}`}>
              <button
                onClick={() => setTimeframe("session")}
                className={`${tabBase} ${timeframe === "session" ? tabActive : tabInactive}`}
              >
                <span className="flex items-center gap-1"><Zap size={10} /> Session</span>
              </button>
              <button
                onClick={() => setTimeframe("today")}
                className={`${tabBase} ${timeframe === "today" ? tabActive : tabInactive}`}
              >
                <span className="flex items-center gap-1"><Sun size={10} /> Today</span>
              </button>
              <button
                onClick={() => setTimeframe("month")}
                className={`${tabBase} ${timeframe === "month" ? tabActive : tabInactive}`}
              >
                <span className="flex items-center gap-1"><Calendar size={10} /> Month</span>
              </button>
            </div>

            <div className="px-3 pt-3 pb-1">
              <div className="flex justify-between items-baseline">
                <span className={`text-xl font-bold ${t.colors.text}`}>
                  {formatCost(data.totalCost)}
                </span>
                <span className={`text-xs ${t.colors.textMuted}`}>
                  {formatTokens(data.totalTokens)} tokens
                </span>
              </div>
              {data.callCount !== null && data.callCount > 0 && (
                <div className={`text-xs ${t.colors.textMuted} mt-0.5`}>
                  {data.callCount} API {data.callCount === 1 ? "call" : "calls"}
                </div>
              )}
            </div>

            <div className="px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ArrowDownLeft size={12} className="text-blue-400" />
                  <span className={`text-xs ${t.colors.textMuted}`}>Input</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${t.colors.textMuted}`}>
                    {formatTokens(data.inputTokens)}
                  </span>
                  <span className={`text-xs font-medium ${t.colors.text} w-16 text-right`}>
                    {formatCost(data.inputCost)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ArrowUpRight size={12} className="text-emerald-400" />
                  <span className={`text-xs ${t.colors.textMuted}`}>Output</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${t.colors.textMuted}`}>
                    {formatTokens(data.outputTokens)}
                  </span>
                  <span className={`text-xs font-medium ${t.colors.text} w-16 text-right`}>
                    {formatCost(data.outputCost)}
                  </span>
                </div>
              </div>

              {totalCached > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-amber-400">
                      <path d="M2 3C2 2 4 1 6 1s4 1 4 2-2 2-4 2S2 4 2 3z" fill="currentColor" opacity="0.5" />
                      <path d="M2 3v2c0 1 2 2 4 2s4-1 4-2V3" stroke="currentColor" strokeWidth="1" />
                      <path d="M2 7v2c0 1 2 2 4 2s4-1 4-2V7" stroke="currentColor" strokeWidth="1" />
                    </svg>
                    <span className={`text-xs ${t.colors.textMuted}`}>Cached</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${t.colors.textMuted}`}>
                      {formatTokens(totalCached)}
                    </span>
                    <span className={`text-xs font-medium text-amber-400 w-16 text-right`}>
                      {data.cacheReadTokens > 0
                        ? `${formatTokens(data.cacheReadTokens)} read`
                        : "write"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {session.entries.length > 0 && (
              <div className={`px-3 py-2 border-t ${t.colors.border} ${t.colors.bgTertiary}`}>
                <div className={`text-xs ${t.colors.textMuted}`}>Last call:</div>
                <div className={`text-xs ${t.colors.text} mt-0.5`}>
                  {session.entries[session.entries.length - 1].model.split("-").slice(0, 2).join(" ")}
                  {" · "}
                  {formatTokens(session.entries[session.entries.length - 1].totalTokens)} tokens
                  {" · "}
                  {formatCost(session.entries[session.entries.length - 1].cost)}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default UsageIndicator;