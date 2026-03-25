import { useState, useEffect } from "react";
import { useUsageStore } from "../../stores/usageStore";
import type { SessionSummary } from "../../stores/usageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

function UsageSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const {
    session,
    monthlyTokens,
    monthlyInputTokens,
    monthlyOutputTokens,
    monthlyCost,
    monthlyInputCost,
    monthlyOutputCost,
    allTimeTokens,
    allTimeInputTokens,
    allTimeOutputTokens,
    allTimeCost,
    allTimeInputCost,
    allTimeOutputCost,
    monthlyBudget,
    budgetAlertEnabled,
    budgetAlertThreshold,
    setMonthlyBudget,
    setBudgetAlertEnabled,
    setBudgetAlertThreshold,
    resetSession,
    clearAllData,
    // Session history
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

  // Load session history on mount and when filter changes
  useEffect(() => {
    const options: { fromDate?: number; toDate?: number } = {};
    if (dateFilter) {
      const d = new Date(dateFilter);
      options.fromDate = d.getTime();
      options.toDate = d.getTime() + 86400000; // +24h
    }
    loadSessionHistory(options);
  }, [dateFilter, loadSessionHistory]);

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

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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
    budgetPercent >= 100
      ? "bg-red-500"
      : budgetPercent >= 80
        ? "bg-amber-500"
        : "bg-green-500";

  const handleBudgetSave = () => {
    const val = parseFloat(budgetInput);
    if (!budgetInput || isNaN(val) || val <= 0) {
      setMonthlyBudget(null);
    } else {
      setMonthlyBudget(val);
    }
  };

  const isDark = theme !== "light";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className={`text-lg font-semibold ${t.colors.text}`}>
          Usage & Costs
        </h2>
        <p className={`text-sm ${t.colors.textMuted} mt-1`}>
          Track your API token usage and costs. All data stored locally on your
          device.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Session */}
        <div
          className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}
        >
          <span className={`text-sm font-medium ${t.colors.textMuted}`}>
            This Session
          </span>
          <div className={`text-2xl font-bold ${t.colors.text} mt-1`}>
            {formatCost(session.totalCost)}
          </div>
          <div className={`text-sm ${t.colors.textMuted} mt-1`}>
            {formatTokens(session.totalTokens)} tokens · {session.entries.length}{" "}
            {session.entries.length === 1 ? "call" : "calls"}
          </div>
          <div className={`mt-3 pt-3 border-t ${t.colors.border} space-y-1`}>
            <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
              <span>Input</span>
              <span>
                {formatTokens(session.totalInputTokens || 0)} · {formatCost(session.totalInputCost || 0)}
              </span>
            </div>
            <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
              <span>Output</span>
              <span>
                {formatTokens(session.totalOutputTokens || 0)} · {formatCost(session.totalOutputCost || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Monthly */}
        <div
          className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}
        >
          <span className={`text-sm font-medium ${t.colors.textMuted}`}>
            This Month
          </span>
          <div className={`text-2xl font-bold ${t.colors.text} mt-1`}>
            {formatCost(monthlyCost)}
          </div>
          <div className={`text-sm ${t.colors.textMuted} mt-1`}>
            {formatTokens(monthlyTokens)} tokens
          </div>
          <div className={`mt-3 pt-3 border-t ${t.colors.border} space-y-1`}>
            <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
              <span>Input</span>
              <span>
                {formatTokens(monthlyInputTokens || 0)} · {formatCost(monthlyInputCost || 0)}
              </span>
            </div>
            <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
              <span>Output</span>
              <span>
                {formatTokens(monthlyOutputTokens || 0)} · {formatCost(monthlyOutputCost || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* All Time */}
        <div
          className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}
        >
          <span className={`text-sm font-medium ${t.colors.textMuted}`}>
            All Time
          </span>
          <div className={`text-2xl font-bold ${t.colors.text} mt-1`}>
            {formatCost(allTimeCost)}
          </div>
          <div className={`text-sm ${t.colors.textMuted} mt-1`}>
            {formatTokens(allTimeTokens)} tokens
          </div>
          <div className={`mt-3 pt-3 border-t ${t.colors.border} space-y-1`}>
            <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
              <span>Input</span>
              <span>
                {formatTokens(allTimeInputTokens || 0)} · {formatCost(allTimeInputCost || 0)}
              </span>
            </div>
            <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
              <span>Output</span>
              <span>
                {formatTokens(allTimeOutputTokens || 0)} · {formatCost(allTimeOutputCost || 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Budget Section */}
      <div
        className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}
      >
        <span className={`text-sm font-semibold ${t.colors.text}`}>
          Monthly Budget
        </span>

        {/* Budget input */}
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

        {/* Budget progress bar */}
        {monthlyBudget !== null && monthlyBudget > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className={t.colors.textMuted}>
                {formatCost(monthlyCost)} / ${monthlyBudget.toFixed(0)}
              </span>
              <span className={t.colors.textMuted}>
                {budgetPercent.toFixed(0)}%
              </span>
            </div>
            <div
              className={`w-full h-2 ${t.borderRadius} ${t.colors.bgPrimary} overflow-hidden`}
            >
              <div
                className={`h-full ${budgetColor} transition-all duration-300`}
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
            {budgetPercent >= 80 && (
              <div className="flex items-center gap-1 mt-2">
                <span className="text-xs text-amber-500">
                  {budgetPercent >= 100
                    ? "Budget exceeded!"
                    : `Approaching budget limit (${budgetPercent.toFixed(0)}%)`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Budget alert settings */}
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
                onChange={(e) =>
                  setBudgetAlertThreshold(parseInt(e.target.value))
                }
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

      {/* Recent API Calls (session) */}
      {session.entries.length > 0 && (
        <div
          className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}
        >
          <span className={`text-sm font-semibold ${t.colors.text}`}>
            Session API Calls
          </span>
          <div className="space-y-2 mt-3 max-h-48 overflow-y-auto">
            {[...session.entries].reverse().map((entry) => (
              <div
                key={entry.id}
                className={`flex items-center justify-between text-xs px-2 py-1.5 ${t.borderRadius} ${t.colors.bgPrimary}`}
              >
                <div className={`flex items-center gap-2 ${t.colors.text}`}>
                  <span className="font-mono">
                    {entry.model.split("-").slice(0, 2).join(" ")}
                  </span>
                  <span className={t.colors.textMuted}>
                    {formatTokens(entry.totalTokens)} tokens
                  </span>
                </div>
                <span className="font-medium">{formatCost(entry.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session History */}
      <div
        className={`p-4 ${t.borderRadius} border ${t.colors.border} ${t.colors.bgTertiary}`}
      >
        <div className="flex items-center justify-between mb-3">
          <span className={`text-sm font-semibold ${t.colors.text}`}>
            Session History
          </span>
          {selectedSession && (
            <button
              onClick={clearSelectedSession}
              className={`text-xs px-2 py-1 ${t.borderRadius} border ${t.colors.border} ${t.colors.text} hover:opacity-80 transition-opacity`}
            >
              Back to list
            </button>
          )}
        </div>

        {/* Date filter */}
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

        {/* Session detail view */}
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

            {/* Input/output breakdown */}
            <div className={`pt-2 border-t ${t.colors.border} space-y-1`}>
              <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
                <span>Input</span>
                <span>
                  {formatTokens(selectedSession.summary.totalInputTokens)} · {formatCost(selectedSession.summary.totalInputCost)}
                </span>
              </div>
              <div className={`flex justify-between text-xs ${t.colors.textMuted}`}>
                <span>Output</span>
                <span>
                  {formatTokens(selectedSession.summary.totalOutputTokens)} · {formatCost(selectedSession.summary.totalOutputCost)}
                </span>
              </div>
            </div>

            {selectedSession.summary.models.length > 0 && (
              <div className={`text-xs ${t.colors.textMuted}`}>
                Models: {selectedSession.summary.models.join(", ")}
              </div>
            )}

            {/* Individual API calls */}
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
                      <span className="text-green-500 shrink-0" title="Tokens served from cache">
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

        {/* Session list */}
        {!selectedSession && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {sessionHistory.length === 0 ? (
              <p className={`text-xs ${t.colors.textMuted}`}>
                {dateFilter
                  ? "No sessions found for this date."
                  : "No usage data recorded yet."}
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
                      {/* Show time range if it's a real session (not a full-day group) */}
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
                    <div className={`font-medium ${t.colors.text}`}>
                      {formatCost(s.totalCost)}
                    </div>
                    <div className={t.colors.textMuted}>
                      {formatTokens(s.totalTokens)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Actions */}
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
              onClick={() => {
                clearAllData();
                setShowClearConfirm(false);
                setBudgetInput("");
              }}
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

      {/* Privacy note */}
      <p className={`text-xs ${t.colors.textMuted}`}>
        All usage data is stored locally on your device. Nothing is sent to our
        servers.
      </p>
    </div>
  );
}

export default UsageSettings;