// ============================================================
// ScreenControlSettings.tsx
// ============================================================
// Settings panel for Desktop App Control feature.
// Allows users to enable/disable screen control, set quality,
// action delay, model preference, registered apps, blocked apps,
// and kill switch hotkey.

import { useState, useEffect } from "react";
import { Monitor, Plus, X, AlertTriangle, FolderOpen, AppWindow } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import {
  loadScreenControlSettings,
  saveScreenControlSettings,
  listMonitors,
  COMMON_APPS,
  type ScreenControlSettings as Settings,
  type MonitorInfo,
} from "../../services/screenControlService";

function ScreenControlSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const [settings, setSettings] = useState<Settings>(loadScreenControlSettings);
  const [newBlockedApp, setNewBlockedApp] = useState("");
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  // Load available monitors
  useEffect(() => {
    if (settings.enabled) {
      listMonitors().then(setMonitors).catch(() => setMonitors([]));
    }
  }, [settings.enabled]);

  // Persist on every change
  useEffect(() => {
    saveScreenControlSettings(settings);
  }, [settings]);

  const update = (partial: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  const addBlockedApp = () => {
    const app = newBlockedApp.trim();
    if (!app) return;
    if (settings.blockedApps.some((b) => b.toLowerCase() === app.toLowerCase())) return;
    update({ blockedApps: [...settings.blockedApps, app] });
    setNewBlockedApp("");
  };

  const removeBlockedApp = (app: string) => {
    update({ blockedApps: settings.blockedApps.filter((b) => b !== app) });
  };

  // ── Common app toggles ──
  const toggleCommonApp = (id: string) => {
    const current = settings.enabledCommonApps;
    if (current.includes(id)) {
      update({ enabledCommonApps: current.filter((a) => a !== id) });
    } else {
      update({ enabledCommonApps: [...current, id] });
    }
  };

  // ── Custom app management ──
  const [customAppLabel, setCustomAppLabel] = useState("");

  const pickCustomApp = async () => {
    const label = customAppLabel.trim();
    if (!label) return;

    try {
      const selected = await open({
        multiple: false,
        title: `Select ${label} executable`,
        filters: [
          { name: "Executables", extensions: ["exe", "app", "sh", "command"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (selected && typeof selected === "string") {
        // Replace existing entry with same label, or add new
        const existing = settings.customApps.filter((a) => a.label.toLowerCase() !== label.toLowerCase());
        update({ customApps: [...existing, { label, path: selected }] });
        setCustomAppLabel("");
      }
    } catch {
      // User cancelled
    }
  };

  const removeCustomApp = (label: string) => {
    update({ customApps: settings.customApps.filter((a) => a.label !== label) });
  };

  // ── Folder management ──
  const FOLDER_PRESETS = ["Music", "Downloads", "Documents", "Projects", "Videos", "Pictures"];

  const pickFolder = async (label: string) => {
    try {
      const selected = await open({ directory: true, multiple: false, title: `Select ${label} folder` });
      if (selected && typeof selected === "string") {
        // Replace existing entry with same label, or add new
        const existing = settings.folders.filter((f) => f.label !== label);
        update({ folders: [...existing, { label, path: selected }] });
      }
    } catch {
      // User cancelled
    }
  };

  const removeFolder = (label: string) => {
    update({ folders: settings.folders.filter((f) => f.label !== label) });
  };

  const [customFolderLabel, setCustomFolderLabel] = useState("");

  return (
    <div className="max-w-2xl">
      <h2 className={`text-lg font-semibold mb-1 ${t.colors.text}`}>Screen Control</h2>
      <p className={`text-sm mb-6 ${t.colors.textMuted}`}>
        Let AI see your screen and control desktop apps via mouse and keyboard simulation.
      </p>

      {/* ── Enable toggle ── */}
      <div className={`flex items-center justify-between p-4 ${t.colors.bgSecondary} ${t.borderRadius} mb-4`}>
        <div className="flex items-center gap-3">
          <Monitor size={20} className={t.colors.text} />
          <div>
            <div className={`text-sm font-medium ${t.colors.text}`}>Enable desktop app control</div>
            <div className={`text-xs ${t.colors.textMuted}`}>
              AI can take screenshots and simulate mouse/keyboard input
            </div>
          </div>
        </div>
        <button
          onClick={() => update({ enabled: !settings.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            settings.enabled ? "bg-green-500" : `${t.colors.bgTertiary}`
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${
              settings.enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      {/* ── Warning banner ── */}
      {settings.enabled && (
        <div className={`flex gap-3 p-3 mb-4 ${t.borderRadius} border`} style={{ borderColor: "rgba(234, 179, 8, 0.3)", background: "rgba(234, 179, 8, 0.08)" }}>
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: "#eab308" }} />
          <div className={`text-xs ${t.colors.textMuted}`}>
            Screen control operates at the OS level. The AI can click anything visible on screen. Use the blocked apps list below to protect sensitive apps, and keep the kill switch hotkey handy.
          </div>
        </div>
      )}

      {/* ── Rest of settings (only show when enabled) ── */}
      {settings.enabled && (
        <div className="space-y-5">

          {/* Model preference */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-2`}>Model for screen reading</label>
            <div className="space-y-2">
              {([
                { value: "haiku", label: "Haiku", desc: "Cheapest — ~1¢ per task. Simple screens only." },
                { value: "sonnet", label: "Sonnet", desc: "Good balance — ~5¢ per task. Most screens." },
                { value: "opus", label: "Opus", desc: "Most accurate — ~25¢ per task. Complex UIs, precise control." },
                { value: "auto", label: "Auto", desc: "Starts with Sonnet, escalates to Opus if it struggles." },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 ${t.colors.bgSecondary} ${t.borderRadius} cursor-pointer hover:opacity-90 transition-opacity`}
                >
                  <input
                    type="radio"
                    name="modelPreference"
                    checked={settings.modelPreference === opt.value}
                    onChange={() => update({ modelPreference: opt.value })}
                    className="mt-1"
                  />
                  <div>
                    <div className={`text-sm font-medium ${t.colors.text}`}>{opt.label}</div>
                    <div className={`text-xs ${t.colors.textMuted}`}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Monitor */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Monitor</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>
              Which screen to capture. Screenshots and click coordinates use this monitor.
            </p>
            {monitors.length > 1 ? (
              <select
                value={settings.selectedMonitor}
                onChange={(e) => update({ selectedMonitor: parseInt(e.target.value) })}
                className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-full`}
              >
                {monitors.map((m) => (
                  <option key={m.index} value={m.index}>
                    {m.name}{m.is_primary ? " (primary)" : ""} — {m.x},{m.y}
                  </option>
                ))}
              </select>
            ) : (
              <div className={`text-xs ${t.colors.textMuted}`}>
                {monitors.length === 1
                  ? `${monitors[0].name} (only monitor detected)`
                  : "Detecting monitors..."}
              </div>
            )}
          </div>

          {/* Action delay */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Action delay</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>
              Time between actions — slower is easier to follow and safer.
            </p>
            <select
              value={settings.actionDelay}
              onChange={(e) => update({ actionDelay: parseInt(e.target.value) })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}
            >
              <option value={200}>200ms (fast)</option>
              <option value={500}>500ms (default)</option>
              <option value={1000}>1 second (safe)</option>
              <option value={2000}>2 seconds (cautious)</option>
            </select>
          </div>

          {/* Screenshot quality */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Screenshot quality</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>
              Lower quality = cheaper (fewer vision tokens). Medium works for most UIs.
            </p>
            <select
              value={settings.screenshotQuality}
              onChange={(e) => update({ screenshotQuality: e.target.value as any })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}
            >
              <option value="low">Low (960px) — cheapest</option>
              <option value="medium">Medium (1280px) — recommended</option>
              <option value="high">High (full res) — most accurate</option>
            </select>
          </div>

          {/* Crop to window */}
          <div className={`flex items-center justify-between p-3 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div>
              <div className={`text-sm font-medium ${t.colors.text}`}>Crop to active window</div>
              <div className={`text-xs ${t.colors.textMuted}`}>
                Only capture the focused app — reduces token cost by ~50%
              </div>
            </div>
            <button
              onClick={() => update({ cropToWindow: !settings.cropToWindow })}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.cropToWindow ? "bg-green-500" : `${t.colors.bgTertiary}`
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${
                  settings.cropToWindow ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          {/* Confirm sensitive actions */}
          <div className={`flex items-center justify-between p-3 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div>
              <div className={`text-sm font-medium ${t.colors.text}`}>Confirm sensitive actions</div>
              <div className={`text-xs ${t.colors.textMuted}`}>
                Pause before clicking send/submit, entering passwords, or making purchases
              </div>
            </div>
            <button
              onClick={() => update({ confirmSensitive: !settings.confirmSensitive })}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.confirmSensitive ? "bg-green-500" : `${t.colors.bgTertiary}`
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${
                  settings.confirmSensitive ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          {/* Kill switch hotkey */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Emergency stop hotkey</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>
              Press this key anytime to immediately stop all screen control actions.
            </p>
            <select
              value={settings.killSwitchKey}
              onChange={(e) => update({ killSwitchKey: e.target.value })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}
            >
              <option value="F10">F10 (default)</option>
              <option value="Escape">Escape</option>
              <option value="F8">F8</option>
              <option value="F9">F9</option>
              <option value="F12">F12</option>
            </select>
          </div>

          {/* ── Registered Apps ── */}
          <div className={`p-4 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div className="flex items-center gap-2 mb-1">
              <AppWindow size={16} className={t.colors.text} />
              <div className={`text-sm font-medium ${t.colors.text}`}>Registered Apps</div>
            </div>
            <p className={`text-xs ${t.colors.textMuted} mb-4`}>
              Apps Omnirun can launch instantly when you say "open X" — no AI screenshots needed for the launch step. Toggle common apps on/off, or add your own.
            </p>

            {/* Common apps — toggle chips */}
            <div className="mb-4">
              <label className={`text-xs ${t.colors.textMuted} block mb-2`}>Common apps</label>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_APPS.map((app) => {
                  const enabled = settings.enabledCommonApps.includes(app.id);
                  return (
                    <button
                      key={app.id}
                      onClick={() => toggleCommonApp(app.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${t.borderRadius} border transition-colors ${
                        enabled
                          ? "border-green-500/40 text-green-400"
                          : `${t.colors.border} ${t.colors.textMuted} opacity-50 hover:opacity-80`
                      }`}
                      style={enabled ? { background: "rgba(45, 184, 122, 0.1)" } : {}}
                      title={`${app.description}${enabled ? " (enabled)" : " (disabled)"}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-green-400" : `${t.colors.bgTertiary}`}`} />
                      {app.label}
                    </button>
                  );
                })}
              </div>
              <p className={`text-[10px] ${t.colors.textMuted} mt-2`}>
                These use Windows app names — no path needed. Click to toggle.
              </p>
            </div>

            {/* Custom apps — list + add */}
            <div>
              <label className={`text-xs ${t.colors.textMuted} block mb-2`}>Custom apps</label>

              {/* Current custom apps */}
              {settings.customApps.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {settings.customApps.map((app) => (
                    <div key={app.label} className={`flex items-center gap-2 px-3 py-2 ${t.colors.bg} ${t.borderRadius} ${t.colors.border} border`}>
                      <AppWindow size={14} className={t.colors.textMuted} />
                      <span className={`text-xs font-medium ${t.colors.text} w-24 flex-shrink-0`}>{app.label}</span>
                      <span className={`text-xs ${t.colors.textMuted} truncate flex-1`}>{app.path}</span>
                      <button
                        onClick={() => removeCustomApp(app.label)}
                        className={`${t.colors.textMuted} hover:text-red-400`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add custom app */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={customAppLabel}
                  onChange={(e) => setCustomAppLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customAppLabel.trim()) {
                      pickCustomApp();
                    }
                  }}
                  placeholder="App name (e.g. Photoshop)"
                  className={`flex-1 ${t.colors.bg} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500`}
                />
                <button
                  onClick={pickCustomApp}
                  disabled={!customAppLabel.trim()}
                  className={`flex items-center gap-1 px-2.5 py-1.5 ${t.borderRadius} text-xs font-medium text-white disabled:opacity-30`}
                  style={{ background: "#2DB87A" }}
                >
                  <FolderOpen size={12} />
                  Browse .exe
                </button>
              </div>
              <p className={`text-[10px] ${t.colors.textMuted} mt-1.5`}>
                For apps not in the common list. Type a name, then pick the .exe file.
              </p>
            </div>
          </div>

          {/* ── User Preferences (context for AI) ── */}
          <div className={`p-4 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div className={`text-sm font-medium ${t.colors.text} mb-1`}>Your setup</div>
            <p className={`text-xs ${t.colors.textMuted} mb-3`}>
              Help the AI understand your computer. This context is sent with every screenshot.
            </p>

            <div className="space-y-3">
              <div>
                <label className={`text-xs ${t.colors.textMuted} block mb-1`}>Display & system</label>
                <textarea
                  value={settings.userContext}
                  onChange={(e) => update({ userContext: e.target.value })}
                  placeholder="e.g. Dual monitor setup, primary is left (1920x1080). Windows 11. Dark mode. Taskbar on bottom, auto-hide off."
                  rows={2}
                  className={`w-full ${t.colors.bg} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none`}
                />
              </div>

              <div>
                <label className={`text-xs ${t.colors.textMuted} block mb-1`}>Apps & shortcuts</label>
                <textarea
                  value={settings.appNotes}
                  onChange={(e) => update({ appNotes: e.target.value })}
                  placeholder="e.g. Music: Windows Media Player (pinned to taskbar). Browser: Chrome. Code editor: VS Code. Spotify is in system tray."
                  rows={2}
                  className={`w-full ${t.colors.bg} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none`}
                />
              </div>

              <div>
                <label className={`text-xs ${t.colors.textMuted} block mb-2`}>Key folders</label>

                {/* Current folders */}
                {settings.folders.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {settings.folders.map((f) => (
                      <div key={f.label} className={`flex items-center gap-2 px-3 py-2 ${t.colors.bg} ${t.borderRadius} ${t.colors.border} border`}>
                        <FolderOpen size={14} className={t.colors.textMuted} />
                        <span className={`text-xs font-medium ${t.colors.text} w-20 flex-shrink-0`}>{f.label}</span>
                        <span className={`text-xs ${t.colors.textMuted} truncate flex-1`}>{f.path}</span>
                        <button
                          onClick={() => pickFolder(f.label)}
                          className={`text-xs ${t.colors.textMuted} hover:${t.colors.text} px-1`}
                          title="Change folder"
                        >
                          Change
                        </button>
                        <button
                          onClick={() => removeFolder(f.label)}
                          className={`${t.colors.textMuted} hover:text-red-400`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Preset folder buttons */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {FOLDER_PRESETS
                    .filter((p) => !settings.folders.some((f) => f.label === p))
                    .map((preset) => (
                      <button
                        key={preset}
                        onClick={() => pickFolder(preset)}
                        className={`flex items-center gap-1 px-2 py-1 text-xs ${t.colors.bgSecondary} ${t.colors.textMuted} ${t.borderRadius} ${t.colors.border} border hover:${t.colors.text} transition-colors`}
                      >
                        <Plus size={10} />
                        {preset}
                      </button>
                    ))}
                </div>

                {/* Custom folder */}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={customFolderLabel}
                    onChange={(e) => setCustomFolderLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customFolderLabel.trim()) {
                        pickFolder(customFolderLabel.trim());
                        setCustomFolderLabel("");
                      }
                    }}
                    placeholder="Custom label..."
                    className={`flex-1 ${t.colors.bg} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500`}
                  />
                  <button
                    onClick={() => {
                      if (customFolderLabel.trim()) {
                        pickFolder(customFolderLabel.trim());
                        setCustomFolderLabel("");
                      }
                    }}
                    disabled={!customFolderLabel.trim()}
                    className={`px-2 py-1 ${t.borderRadius} text-xs ${t.colors.textMuted} ${t.colors.bgSecondary} ${t.colors.border} border hover:${t.colors.text} disabled:opacity-30`}
                  >
                    <FolderOpen size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Blocked apps */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Never control these apps</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>
              Screen control will refuse to interact when any of these apps are in focus.
            </p>

            {/* Current blocked apps */}
            {settings.blockedApps.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {settings.blockedApps.map((app) => (
                  <span
                    key={app}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs ${t.colors.bgSecondary} ${t.colors.text} ${t.borderRadius} ${t.colors.border} border`}
                  >
                    {app}
                    <button
                      onClick={() => removeBlockedApp(app)}
                      className={`${t.colors.textMuted} hover:text-red-400 transition-colors`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add new blocked app */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newBlockedApp}
                onChange={(e) => setNewBlockedApp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBlockedApp()}
                placeholder="App name (e.g. Chase, 1Password)"
                className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
              />
              <button
                onClick={addBlockedApp}
                disabled={!newBlockedApp.trim()}
                className={`px-3 py-2 ${t.borderRadius} text-sm font-medium text-white disabled:opacity-40`}
                style={{ background: "#2DB87A" }}
              >
                <Plus size={16} />
              </button>
            </div>

            {/* Suggested apps */}
            {settings.blockedApps.length === 0 && (
              <div className={`mt-2 text-xs ${t.colors.textMuted}`}>
                Suggested: banking apps, password managers, this app.{" "}
                <button
                  onClick={() => update({ blockedApps: ["omnirun", "msedgewebview2", "1Password", "LastPass", "Bitwarden", "Chase", "Bank of America", "Wells Fargo"] })}
                  className="underline hover:opacity-80"
                >
                  Add common defaults
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ScreenControlSettings;