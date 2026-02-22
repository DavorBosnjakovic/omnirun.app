import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes, ThemeKey } from "../../config/themes";
import { Eye, EyeOff, ExternalLink } from "lucide-react";

function GeneralSettings() {
  const {
    theme, mode, timeFormat, fontSize, confirmBeforeDelete, autoSaveFiles,
    webSearchEnabled, searchApiKey,
    setTheme, setMode, setTimeFormat, setFontSize, setConfirmBeforeDelete, setAutoSaveFiles,
    setWebSearchEnabled, setSearchApiKey,
    resetToDefaults,
  } = useSettingsStore();
  const t = themes[theme];
  const [showKey, setShowKey] = useState(false);

  const themeKeys = Object.keys(themes) as ThemeKey[];

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-6">General Settings</h1>

      {/* Theme selection */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Theme
        </label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeKey)}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          {themeKeys.map((key) => (
            <option key={key} value={key}>
              {themes[key].name}
            </option>
          ))}
        </select>
      </div>

      {/* Default mode */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Default Mode
        </label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "simple" | "technical")}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="simple">Simple</option>
          <option value="technical">Technical</option>
        </select>
        <p className={`text-sm mt-1 ${t.colors.textMuted}`}>
          {mode === "simple" 
            ? "Guided experience with visual previews" 
            : "Full code access with technical details"}
        </p>
      </div>

      {/* Time format */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Time Format
        </label>
        <select
          value={timeFormat}
          onChange={(e) => setTimeFormat(e.target.value as "12h" | "24h")}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="12h">12-hour (2:30 PM)</option>
          <option value="24h">24-hour (14:30)</option>
        </select>
      </div>

      {/* Font size */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Font Size
        </label>
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as "small" | "medium" | "large")}
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="small">Small</option>
          <option value="medium">Medium (default)</option>
          <option value="large">Large</option>
        </select>
      </div>

      {/* Auto-save */}
      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSaveFiles}
            onChange={(e) => setAutoSaveFiles(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <span className="font-medium">Auto-save files</span>
            <p className={`text-sm ${t.colors.textMuted}`}>
              Automatically save files written by AI to your project
            </p>
          </div>
        </label>
      </div>

      {/* Confirm before delete */}
      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmBeforeDelete}
            onChange={(e) => setConfirmBeforeDelete(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <span className="font-medium">Confirm before deleting</span>
            <p className={`text-sm ${t.colors.textMuted}`}>
              Ask for confirmation before deleting files or clearing chat
            </p>
          </div>
        </label>
      </div>

      {/* ── Web Search ─────────────────────────────────────────── */}
      <div className="mb-6 pt-4 border-t border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Web Search</h2>
        <p className={`text-sm mb-4 ${t.colors.textMuted}`}>
          Let the AI search the internet for documentation, solutions, and API references during conversations.
        </p>

        {/* Enable toggle */}
        <div className="mb-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={webSearchEnabled}
              onChange={(e) => setWebSearchEnabled(e.target.checked)}
              className="w-4 h-4"
            />
            <div>
              <span className="font-medium">Enable web search</span>
              <p className={`text-sm ${t.colors.textMuted}`}>
                AI can search when it needs docs, error solutions, or current info
              </p>
            </div>
          </label>
        </div>

        {/* API key input */}
        <div className="mb-2">
          <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
            Brave Search API Key
          </label>
          <div className="flex gap-2 max-w-md">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={searchApiKey}
                onChange={(e) => setSearchApiKey(e.target.value)}
                placeholder="BSA..."
                className={`w-full ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 pr-10 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-sm`}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted} hover:${t.colors.text}`}
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <p className={`text-xs mt-2 ${t.colors.textMuted}`}>
            Free: 2,000 searches/month.{" "}
            <a
              href="https://brave.com/search/api/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline hover:opacity-80"
              onClick={(e) => {
                e.preventDefault();
                import("@tauri-apps/plugin-opener").then(({ open }) => open("https://brave.com/search/api/"));
              }}
            >
              Get a free key <ExternalLink size={11} />
            </a>
          </p>
        </div>

        {/* Status indicator */}
        {webSearchEnabled && (
          <div className={`mt-3 text-xs ${searchApiKey.trim() ? "text-green-400" : "text-amber-400"}`}>
            {searchApiKey.trim()
              ? "✓ Web search is active"
              : "⚠ Add your API key above to enable search"}
          </div>
        )}
      </div>

      {/* Startup behavior */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          On Startup
        </label>
        <select
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="lastProject">Open last project</option>
          <option value="newChat">Start new chat</option>
          <option value="projectList">Show project list</option>
        </select>
      </div>

      {/* Language */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Language
        </label>
        <select
          className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      {/* Reset */}
      <div className="mb-6 pt-4 border-t border-gray-700">
        <button
          onClick={() => {
            if (window.confirm("Reset all settings to defaults? This will also clear your search API key.")) {
              resetToDefaults();
            }
          }}
          className={`px-4 py-2 ${t.borderRadius} text-sm text-red-400 hover:text-red-300 ${t.colors.bgSecondary} hover:opacity-80`}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

export default GeneralSettings;