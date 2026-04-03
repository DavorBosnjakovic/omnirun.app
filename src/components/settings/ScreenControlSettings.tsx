// ============================================================
// ScreenControlSettings.tsx
// ============================================================
// Settings panel for Desktop App Control feature.

import { useState, useEffect } from "react";
import { Monitor, Plus, X, AlertTriangle, FolderOpen, Folder, RefreshCw, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import {
  loadScreenControlSettings,
  saveScreenControlSettings,
  listMonitors,
  scanOmniFiles,
  launchApp,
  type ScreenControlSettings as Settings,
  type MonitorInfo,
  type ShortcutEntry,
} from "../../services/screenControlService";
import elipseDark from "../../assets/elipse_transparent_dark.svg";
import elipseLight from "../../assets/elipse_transparent_light.svg";

function ScreenControlSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const [settings, setSettings] = useState<Settings>(loadScreenControlSettings);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [omniFiles, setOmniFiles] = useState<ShortcutEntry[]>([]);
  const [detectingMonitors, setDetectingMonitors] = useState(false);

  // Load monitors
  const detectMonitors = async () => {
    setDetectingMonitors(true);
    try { setMonitors(await listMonitors()); } catch { setMonitors([]); }
    finally { setDetectingMonitors(false); }
  };

  useEffect(() => {
    if (settings.enabled) { detectMonitors(); }
  }, [settings.enabled]);

  // Scan omni-files when path changes
  const refreshOmniFiles = async () => {
    if (settings.omniFilesPath) {
      const files = await scanOmniFiles();
      setOmniFiles(files);
    } else {
      setOmniFiles([]);
    }
  };

  useEffect(() => {
    if (settings.enabled) { refreshOmniFiles(); }
  }, [settings.enabled, settings.omniFilesPath]);

  // Persist on every change
  useEffect(() => {
    saveScreenControlSettings(settings);
  }, [settings]);

  const update = (partial: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  // ── omni-files folder picker ──
  const pickOmniFilesFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Choose your omni-files folder" });
      if (selected && typeof selected === "string") {
        update({ omniFilesPath: selected });
      }
    } catch { /* cancelled */ }
  };

  // Open omni-files folder in system file explorer
  const openOmniFilesFolder = async () => {
    if (!settings.omniFilesPath) return;
    try {
      await launchApp(settings.omniFilesPath);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  // ── Key folders ──
  const FOLDER_PRESETS = ["Music", "Downloads", "Documents", "Projects", "Videos", "Pictures"];
  const [customFolderLabel, setCustomFolderLabel] = useState("");

  const pickFolder = async (label: string) => {
    try {
      const selected = await open({ directory: true, multiple: false, title: `Select ${label} folder` });
      if (selected && typeof selected === "string") {
        const existing = settings.folders.filter((f) => f.label !== label);
        update({ folders: [...existing, { label, path: selected }] });
      }
    } catch { /* cancelled */ }
  };

  const removeFolder = (label: string) => {
    update({ folders: settings.folders.filter((f) => f.label !== label) });
  };

  // ── Logo ──
  const logoSrc = theme === "light" || theme === "highContrast" ? elipseLight : elipseDark;

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

      {/* ── Warning ── */}
      {settings.enabled && (
        <div className={`flex gap-3 p-3 mb-4 ${t.borderRadius} border`} style={{ borderColor: "rgba(234, 179, 8, 0.3)", background: "rgba(234, 179, 8, 0.08)" }}>
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: "#eab308" }} />
          <div className={`text-xs ${t.colors.textMuted}`}>
            Screen control operates at the OS level. The AI can only launch files from your omni-files folder. Keep the kill switch hotkey handy.
          </div>
        </div>
      )}

      {settings.enabled && (
        <div className="space-y-5">

          {/* ── Monitor Setup ── */}
          <div className={`p-4 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div className="flex items-center justify-between mb-1">
              <div className={`text-sm font-medium ${t.colors.text}`}>Monitor setup</div>
              <button
                onClick={detectMonitors}
                disabled={detectingMonitors}
                className={`flex items-center gap-1 text-[10px] ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                title="Re-detect monitors"
              >
                <RefreshCw size={10} className={detectingMonitors ? "animate-spin" : ""} />
                {detectingMonitors ? "Detecting..." : "Re-detect"}
              </button>
            </div>

            {/* Monitor count */}
            <div className="mb-4">
              <p className={`text-xs ${t.colors.textMuted} mb-2`}>How many monitors are you using?</p>
              <div className="flex gap-2">
                {[1, 2, 3].map((count) => {
                  const isSelected = monitors.length === count || (monitors.length === 0 && count === 1);
                  return (
                    <button
                      key={count}
                      className={`flex items-center justify-center w-16 h-10 ${t.borderRadius} border-2 text-sm font-semibold transition-all ${
                        isSelected
                          ? "border-green-500 text-green-400"
                          : `${t.colors.border} ${t.colors.textMuted} opacity-40`
                      }`}
                      style={isSelected ? { background: "rgba(45, 184, 122, 0.08)" } : {}}
                    >
                      {count}
                    </button>
                  );
                })}
                <span className={`text-xs ${t.colors.textMuted} self-center ml-2`}>
                  {monitors.length > 0 ? `${monitors.length} detected` : "Detecting..."}
                </span>
              </div>
            </div>

            {/* Monitor details */}
            {monitors.length > 0 && (
              <div className="mb-4">
                <p className={`text-xs ${t.colors.textMuted} mb-2`}>Detected monitors:</p>
                <div className="space-y-1.5">
                  {monitors.slice().sort((a, b) => a.x - b.x).map((mon) => (
                    <div key={mon.index} className={`flex items-center gap-3 px-3 py-2 ${t.colors.bg} ${t.borderRadius} ${t.colors.border} border text-xs`}>
                      <span className={`font-bold ${t.colors.text}`}>{mon.index + 1}</span>
                      <span className={t.colors.text}>{mon.width}×{mon.height}</span>
                      <span className={t.colors.textMuted}>at ({mon.x}, {mon.y})</span>
                      {mon.is_primary && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Primary</span>
                      )}
                      {mon.index === settings.omnirunMonitor && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(45,184,122,0.15)", color: "#2DB87A" }}>Omnirun</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Visual layout — multi monitor */}
            {monitors.length > 1 && (
              <>
                <p className={`text-xs ${t.colors.textMuted} mb-3`}>
                  Click the monitor where Omnirun lives. Apps will open on the other one.
                </p>
                <div className="flex items-end justify-center gap-2 mb-3" style={{ minHeight: 120 }}>
                  {monitors.slice().sort((a, b) => a.x - b.x).map((mon) => {
                    const isOmnirun = mon.index === settings.omnirunMonitor;
                    const maxH = 120;
                    const maxW = 180;
                    const aspect = mon.width / mon.height;
                    let h = maxH;
                    let w = Math.round(h * aspect);
                    if (w > maxW) { w = maxW; h = Math.round(w / aspect); }

                    return (
                      <button
                        key={mon.index}
                        onClick={() => update({ omnirunMonitor: mon.index })}
                        className={`relative flex flex-col items-center justify-center border-2 ${t.borderRadius} transition-all cursor-pointer`}
                        style={{
                          width: w, height: h,
                          borderColor: isOmnirun ? "#2DB87A" : "rgba(100,100,100,0.3)",
                          background: isOmnirun ? "rgba(45, 184, 122, 0.08)" : "rgba(100, 100, 100, 0.05)",
                        }}
                        title={isOmnirun ? "Omnirun is here" : "Click to set as Omnirun monitor"}
                      >
                        <span className="absolute top-1.5 left-2.5 text-lg font-bold" style={{ color: isOmnirun ? "#2DB87A" : "rgba(150,150,150,0.5)" }}>
                          {mon.index + 1}
                        </span>
                        {isOmnirun ? (
                          <>
                            <img src={logoSrc} alt="Omnirun" className="w-7 h-7 mb-0.5" />
                            <span className="text-[10px] font-medium" style={{ color: "#2DB87A" }}>Omnirun</span>
                          </>
                        ) : (
                          <>
                            <Monitor size={20} className={t.colors.textMuted} style={{ opacity: 0.4 }} />
                            <span className={`text-[10px] ${t.colors.textMuted} mt-0.5`}>Apps here</span>
                          </>
                        )}
                        <span className={`text-[9px] ${t.colors.textMuted} mt-1`}>{mon.width}×{mon.height}</span>
                      </button>
                    );
                  })}
                </div>
                <p className={`text-[10px] ${t.colors.textMuted} text-center`}>
                  Screenshots will capture monitor {(() => {
                    const appsMon = monitors.find(m => m.index !== settings.omnirunMonitor);
                    return appsMon ? appsMon.index + 1 : 1;
                  })()} (where apps open)
                </p>
              </>
            )}

            {/* Single monitor */}
            {monitors.length === 1 && (
              <div className="flex items-end justify-center mb-2" style={{ minHeight: 120 }}>
                <div
                  className={`relative flex flex-col items-center justify-center border-2 ${t.borderRadius}`}
                  style={{ width: 200, height: 120, borderColor: "#2DB87A", background: "rgba(45, 184, 122, 0.08)" }}
                >
                  <img src={logoSrc} alt="Omnirun" className="w-8 h-8 mb-1 opacity-60" />
                  <span className={`text-xs font-medium ${t.colors.text}`}>Omnirun + Apps</span>
                  <span className={`text-[10px] ${t.colors.textMuted}`}>{monitors[0].width}×{monitors[0].height}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── omni-files Folder ── */}
          <div className={`p-4 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div className="flex items-center gap-2 mb-1">
              <Folder size={16} className={t.colors.text} />
              <div className={`text-sm font-medium ${t.colors.text}`}>omni-files</div>
            </div>
            <p className={`text-xs ${t.colors.textMuted} mb-3`}>
              Create a folder anywhere and drop files you want Omnirun to open — shortcuts, documents, scripts, media, anything.
              When you say "open [name]", Omnirun finds it here and launches it instantly.
            </p>

            {/* Folder path + Browse + Open */}
            <div className="flex gap-2 mb-3">
              <div
                className={`flex-1 flex items-center gap-2 px-3 py-2 ${t.colors.bg} ${t.colors.border} border ${t.borderRadius} text-xs ${
                  settings.omniFilesPath ? t.colors.text : t.colors.textMuted
                }`}
              >
                <FolderOpen size={14} className={t.colors.textMuted} />
                {settings.omniFilesPath || "No folder selected"}
              </div>
              <button
                onClick={pickOmniFilesFolder}
                className={`px-3 py-2 ${t.borderRadius} text-xs font-medium text-white`}
                style={{ background: "#2DB87A" }}
              >
                Browse
              </button>
              {settings.omniFilesPath && (
                <>
                  <button
                    onClick={openOmniFilesFolder}
                    className={`flex items-center gap-1 px-2 py-2 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text}`}
                    title="Open in file explorer"
                  >
                    <ExternalLink size={14} />
                  </button>
                  <button
                    onClick={refreshOmniFiles}
                    className={`px-2 py-2 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text}`}
                    title="Refresh"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={() => update({ omniFilesPath: "" })}
                    className={`px-2 py-2 ${t.borderRadius} ${t.colors.textMuted} hover:text-red-400`}
                    title="Clear"
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>

            {/* Found files */}
            {omniFiles.length > 0 ? (
              <div>
                <div className={`text-[10px] uppercase tracking-wider ${t.colors.textMuted} mb-1.5`}>
                  {omniFiles.length} file{omniFiles.length !== 1 ? "s" : ""} ready:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {omniFiles.map((f) => (
                    <span
                      key={f.path}
                      className={`px-2 py-1 text-xs ${t.colors.bg} ${t.colors.border} border ${t.borderRadius} ${t.colors.text}`}
                    >
                      {f.name}
                      {f.extension && <span className={`${t.colors.textMuted} ml-1`}>.{f.extension}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ) : settings.omniFilesPath ? (
              <p className={`text-xs ${t.colors.textMuted} italic`}>
                Folder is empty. Drop files in to get started.
              </p>
            ) : null}
          </div>

          {/* ── Key Folders ── */}
          <div className={`p-4 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div className={`text-sm font-medium ${t.colors.text} mb-1`}>Key folders</div>
            <p className={`text-xs ${t.colors.textMuted} mb-3`}>
              Tell Omnirun where your important folders are. Used for "play my music" or "open my documents".
            </p>

            {settings.folders.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {settings.folders.map((f) => (
                  <div key={f.label} className={`flex items-center gap-2 px-3 py-2 ${t.colors.bg} ${t.borderRadius} ${t.colors.border} border`}>
                    <FolderOpen size={14} className={t.colors.textMuted} />
                    <span className={`text-xs font-medium ${t.colors.text} w-20 flex-shrink-0`}>{f.label}</span>
                    <span className={`text-xs ${t.colors.textMuted} truncate flex-1`}>{f.path}</span>
                    <button onClick={() => pickFolder(f.label)} className={`text-xs ${t.colors.textMuted} hover:${t.colors.text} px-1`}>Change</button>
                    <button onClick={() => removeFolder(f.label)} className={`${t.colors.textMuted} hover:text-red-400`}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 mb-2">
              {FOLDER_PRESETS
                .filter((p) => !settings.folders.some((f) => f.label === p))
                .map((preset) => (
                  <button
                    key={preset}
                    onClick={() => pickFolder(preset)}
                    className={`flex items-center gap-1 px-2 py-1 text-xs ${t.colors.bgSecondary} ${t.colors.textMuted} ${t.borderRadius} ${t.colors.border} border hover:${t.colors.text} transition-colors`}
                  >
                    <Plus size={10} /> {preset}
                  </button>
                ))}
            </div>

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
                onClick={() => { if (customFolderLabel.trim()) { pickFolder(customFolderLabel.trim()); setCustomFolderLabel(""); } }}
                disabled={!customFolderLabel.trim()}
                className={`px-2 py-1 ${t.borderRadius} text-xs ${t.colors.textMuted} ${t.colors.bgSecondary} ${t.colors.border} border hover:${t.colors.text} disabled:opacity-30`}
              >
                <FolderOpen size={12} />
              </button>
            </div>
          </div>

          {/* ── Model ── */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-2`}>Model for screen reading</label>
            <div className="space-y-2">
              {([
                { value: "haiku", label: "Haiku", desc: "Cheapest — ~1¢ per task. Simple screens." },
                { value: "sonnet", label: "Sonnet", desc: "Good balance — ~1-5¢ per task. Most screens." },
                { value: "opus", label: "Opus", desc: "Most accurate — ~10-25¢ per task. Complex UIs." },
                { value: "auto", label: "Auto", desc: "Starts with Sonnet, escalates if it struggles." },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 ${t.colors.bgSecondary} ${t.borderRadius} cursor-pointer hover:opacity-90 transition-opacity`}
                >
                  <input type="radio" name="modelPreference" checked={settings.modelPreference === opt.value} onChange={() => update({ modelPreference: opt.value })} className="mt-1" />
                  <div>
                    <div className={`text-sm font-medium ${t.colors.text}`}>{opt.label}</div>
                    <div className={`text-xs ${t.colors.textMuted}`}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Action delay ── */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Action delay</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>Time between actions — slower is easier to follow.</p>
            <select value={settings.actionDelay} onChange={(e) => update({ actionDelay: parseInt(e.target.value) })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}>
              <option value={200}>200ms (fast)</option>
              <option value={500}>500ms (default)</option>
              <option value={1000}>1 second (safe)</option>
              <option value={2000}>2 seconds (cautious)</option>
            </select>
          </div>

          {/* ── Screenshot quality ── */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Screenshot quality</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>Lower = cheaper. Low works for most UIs.</p>
            <select value={settings.screenshotQuality} onChange={(e) => update({ screenshotQuality: e.target.value as any })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}>
              <option value="low">Low (960px) — cheapest</option>
              <option value="medium">Medium (1280px)</option>
              <option value="high">High (full res) — most accurate</option>
            </select>
          </div>

          {/* ── Crop to window ── */}
          <div className={`flex items-center justify-between p-3 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div>
              <div className={`text-sm font-medium ${t.colors.text}`}>Crop to active window</div>
              <div className={`text-xs ${t.colors.textMuted}`}>Only capture the focused app — saves tokens</div>
            </div>
            <button onClick={() => update({ cropToWindow: !settings.cropToWindow })}
              className={`relative w-11 h-6 rounded-full transition-colors ${settings.cropToWindow ? "bg-green-500" : `${t.colors.bgTertiary}`}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${settings.cropToWindow ? "translate-x-5" : ""}`} />
            </button>
          </div>

          {/* ── Confirm sensitive ── */}
          <div className={`flex items-center justify-between p-3 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div>
              <div className={`text-sm font-medium ${t.colors.text}`}>Confirm sensitive actions</div>
              <div className={`text-xs ${t.colors.textMuted}`}>Pause before send/submit, passwords, purchases</div>
            </div>
            <button onClick={() => update({ confirmSensitive: !settings.confirmSensitive })}
              className={`relative w-11 h-6 rounded-full transition-colors ${settings.confirmSensitive ? "bg-green-500" : `${t.colors.bgTertiary}`}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${settings.confirmSensitive ? "translate-x-5" : ""}`} />
            </button>
          </div>

          {/* ── Kill switch ── */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Emergency stop hotkey</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>Press anytime to immediately stop screen control.</p>
            <select value={settings.killSwitchKey} onChange={(e) => update({ killSwitchKey: e.target.value })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}>
              <option value="F10">F10 (default)</option>
              <option value="Escape">Escape</option>
              <option value="F8">F8</option>
              <option value="F9">F9</option>
              <option value="F12">F12</option>
            </select>
          </div>

        </div>
      )}
    </div>
  );
}

export default ScreenControlSettings;