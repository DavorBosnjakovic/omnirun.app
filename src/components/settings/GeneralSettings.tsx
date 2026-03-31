import { useState, useRef, useEffect } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes, ThemeKey } from "../../config/themes";
import { Eye, EyeOff, ExternalLink, ChevronDown } from "lucide-react";

// ── Reusable custom dropdown ─────────────────────────────────

interface DropdownOption {
  value: string;
  label: string;
}

interface SettingsDropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  theme: any;
}

function SettingsDropdown({ value, options, onChange, theme: t }: SettingsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label || value;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={ref} className="relative w-full max-w-xs">
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} ${t.colors.text} hover:bg-white/10 transition-colors text-left`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          size={12}
          className={`${t.colors.textMuted} flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          className={`absolute top-full mt-1 left-0 z-50 w-full ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-xl overflow-hidden`}
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center px-3 py-2 text-sm text-left transition-colors ${
                  option.value === value
                    ? "bg-blue-600/20 text-blue-300"
                    : `${t.colors.text} hover:bg-white/10`
                }`}
              >
                <span className="truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

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

  const themeOptions: DropdownOption[] = themeKeys.map((key) => ({
    value: key,
    label: themes[key].name,
  }));

  const modeOptions: DropdownOption[] = [
    { value: "simple", label: "Simple" },
    { value: "technical", label: "Technical" },
  ];

  const timeFormatOptions: DropdownOption[] = [
    { value: "12h", label: "12-hour (2:30 PM)" },
    { value: "24h", label: "24-hour (14:30)" },
  ];

  const fontSizeOptions: DropdownOption[] = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium (default)" },
    { value: "large", label: "Large" },
  ];

  const startupOptions: DropdownOption[] = [
    { value: "lastProject", label: "Open last project" },
    { value: "newChat", label: "Start new chat" },
    { value: "projectList", label: "Show project list" },
  ];

  const languageOptions: DropdownOption[] = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
    { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" },
  ];

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-6">General Settings</h1>

      {/* Theme selection */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Theme
        </label>
        <SettingsDropdown
          value={theme}
          options={themeOptions}
          onChange={(v) => setTheme(v as ThemeKey)}
          theme={t}
        />
      </div>

      {/* Default mode */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Default Mode
        </label>
        <SettingsDropdown
          value={mode}
          options={modeOptions}
          onChange={(v) => setMode(v as "simple" | "technical")}
          theme={t}
        />
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
        <SettingsDropdown
          value={timeFormat}
          options={timeFormatOptions}
          onChange={(v) => setTimeFormat(v as "12h" | "24h")}
          theme={t}
        />
      </div>

      {/* Chat font size */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Chat Font Size
        </label>
        <SettingsDropdown
          value={fontSize}
          options={fontSizeOptions}
          onChange={(v) => setFontSize(v as "small" | "medium" | "large")}
          theme={t}
        />
        <p className={`text-sm mt-1 ${t.colors.textMuted}`}>
          Controls the text size of chat messages
        </p>
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
        <SettingsDropdown
          value="lastProject"
          options={startupOptions}
          onChange={() => {}}
          theme={t}
        />
      </div>

      {/* Language */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Language
        </label>
        <SettingsDropdown
          value="en"
          options={languageOptions}
          onChange={() => {}}
          theme={t}
        />
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