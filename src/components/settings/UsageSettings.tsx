import { useState } from "react";
import { useUsageStore } from "../../stores/usageStore";
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
  } = useUsageStore();

  const [budgetInput, setBudgetInput] = useState(
    monthlyBudget !== null ? monthlyBudget.toString() : ""
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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