// ============================================================
// VoiceSettings.tsx
// ============================================================
// Settings panel for voice control.
// Replace existing file: src/components/settings/VoiceSettings.tsx

import { useState } from "react";
import { Mic, MicOff, AlertTriangle, Plus, X, Ear, MessageSquare } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { useVoiceStore } from "../../stores/voiceStore";
import type { VoiceMode, VoiceLanguage } from "../../services/voiceService";

const LANGUAGES: { value: VoiceLanguage; label: string }[] = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es-ES", label: "Español" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "it-IT", label: "Italiano" },
  { value: "pt-BR", label: "Português (BR)" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "zh-CN", label: "中文" },
  { value: "nl-NL", label: "Nederlands" },
  { value: "ru-RU", label: "Русский" },
  { value: "sr-RS", label: "Srpski" },
];

const SENSITIVE_APP_DEFAULTS = [
  "1Password", "Bitwarden", "LastPass", "KeePass",
  "Chase", "Bank of America", "Wells Fargo", "PayPal",
  "Revolut", "Wise",
];

function VoiceSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { settings, updateSettings, voiceState, isMuted, isAvailable, toggleMute } = useVoiceStore();
  const [newSensitiveApp, setNewSensitiveApp] = useState("");
  const [testingMic, setTestingMic] = useState(false);
  const [testLevel, setTestLevel] = useState(0);

  const update = (partial: Parameters<typeof updateSettings>[0]) => updateSettings(partial);

  // ── Toggle helper ──
  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked ? "bg-green-500" : `${t.colors.bgTertiary}`
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );

  // ── Mic test ──
  const startMicTest = async () => {
    setTestingMic(true);
    setTestLevel(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setTestLevel(Math.min(100, Math.round(avg * 1.5)));
      }, 100);

      // Stop after 5 seconds
      setTimeout(() => {
        clearInterval(interval);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        setTestingMic(false);
      }, 5000);
    } catch {
      setTestingMic(false);
    }
  };

  if (!isAvailable) {
    return (
      <div className={`${t.colors.text}`}>
        <h1 className="text-2xl font-bold mb-2">Voice Settings</h1>
        <div className={`p-4 ${t.borderRadius} ${t.colors.bgSecondary} flex items-center gap-3`}>
          <MicOff size={20} className="text-red-400" />
          <div>
            <p className="font-medium">Speech recognition not available</p>
            <p className={`text-sm ${t.colors.textMuted}`}>
              Your system doesn't support the Web Speech API. Voice features require a Chromium-based WebView.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">Voice Settings</h1>
      <p className={`${t.colors.textMuted} mb-6`}>
        Control how you interact with Omnirun using your voice.
      </p>

      {/* ── Enable toggle ── */}
      <div className={`flex items-center justify-between p-4 ${t.colors.bgSecondary} ${t.borderRadius} mb-4`}>
        <div className="flex items-center gap-3">
          <Mic size={20} className={t.colors.text} />
          <div>
            <div className={`text-sm font-medium ${t.colors.text}`}>Enable voice input</div>
            <div className={`text-xs ${t.colors.textMuted}`}>Use your microphone to talk to Omnirun</div>
          </div>
        </div>
        <Toggle checked={settings.enabled} onChange={(v) => update({ enabled: v })} />
      </div>

      {settings.enabled && (
        <div className="space-y-5">

          {/* ── Voice mode selector ── */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-2`}>Voice mode</label>
            <div className="space-y-2">
              {([
                {
                  value: "push-to-talk" as VoiceMode,
                  icon: Mic,
                  label: "Push to talk",
                  desc: "Hold a button to speak. Simplest and most private.",
                  plan: null,
                },
                {
                  value: "wake-word" as VoiceMode,
                  icon: Ear,
                  label: "Wake word",
                  desc: `Say "${settings.wakeWord}" to activate, then speak your command.`,
                  plan: "Studio+",
                },
                {
                  value: "continuous" as VoiceMode,
                  icon: MessageSquare,
                  label: "Continuous conversation",
                  desc: `Voice stays on during tasks. Say "${settings.continuousExitPhrase}" to stop.`,
                  plan: "Studio+",
                },
              ]).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 ${t.colors.bgSecondary} ${t.borderRadius} cursor-pointer hover:opacity-90 transition-opacity`}
                >
                  <input
                    type="radio"
                    name="voiceMode"
                    checked={settings.mode === opt.value}
                    onChange={() => update({ mode: opt.value })}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <opt.icon size={14} className={t.colors.text} />
                      <span className={`text-sm font-medium ${t.colors.text}`}>{opt.label}</span>
                      {opt.plan && (
                        <span className={`text-[10px] px-1.5 py-0.5 ${t.borderRadius} bg-purple-500/20 text-purple-400`}>
                          {opt.plan}
                        </span>
                      )}
                    </div>
                    <div className={`text-xs ${t.colors.textMuted} mt-0.5`}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Wake word selection ── */}
          {settings.mode === "wake-word" && (
            <div>
              <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Wake word</label>
              <p className={`text-xs ${t.colors.textMuted} mb-2`}>The phrase that activates voice input.</p>
              <select
                value={settings.wakeWord}
                onChange={(e) => update({ wakeWord: e.target.value })}
                className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-64`}
              >
                <option value="Hey Omnirun">Hey Omnirun</option>
                <option value="Hey Dev">Hey Dev</option>
                <option value="Computer">Computer</option>
                <option value="OK Omnirun">OK Omnirun</option>
              </select>
            </div>
          )}

          {/* ── Continuous exit phrase ── */}
          {settings.mode === "continuous" && (
            <div>
              <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Exit phrase</label>
              <p className={`text-xs ${t.colors.textMuted} mb-2`}>Say this to stop continuous listening.</p>
              <input
                type="text"
                value={settings.continuousExitPhrase}
                onChange={(e) => update({ continuousExitPhrase: e.target.value })}
                className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-64`}
              />
            </div>
          )}

          {/* ── Language ── */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Language</label>
            <select
              value={settings.language}
              onChange={(e) => update({ language: e.target.value as VoiceLanguage })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-64`}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>{lang.label}</option>
              ))}
            </select>
          </div>

          {/* ── Silence timeout ── */}
          {settings.mode !== "push-to-talk" && (
            <div>
              <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Silence timeout</label>
              <p className={`text-xs ${t.colors.textMuted} mb-2`}>
                How long to wait after you stop talking before sending the message.
              </p>
              <select
                value={settings.silenceTimeout}
                onChange={(e) => update({ silenceTimeout: parseInt(e.target.value) })}
                className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}
              >
                <option value={1000}>1 second (fast)</option>
                <option value={1500}>1.5 seconds (default)</option>
                <option value={2000}>2 seconds</option>
                <option value={3000}>3 seconds (patient)</option>
              </select>
            </div>
          )}

          {/* ── Mute hotkey ── */}
          <div>
            <label className={`text-sm font-medium ${t.colors.text} block mb-1`}>Global mute hotkey</label>
            <p className={`text-xs ${t.colors.textMuted} mb-2`}>
              Press anytime to mute/unmute — works even when Omnirun isn't focused.
            </p>
            <select
              value={settings.muteHotkey}
              onChange={(e) => update({ muteHotkey: e.target.value })}
              className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm focus:outline-none w-48`}
            >
              <option value="F9">F9 (default)</option>
              <option value="F7">F7</option>
              <option value="F8">F8</option>
              <option value="F11">F11</option>
            </select>
          </div>

          {/* ── Privacy: audio feedback ── */}
          <div className={`flex items-center justify-between p-3 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div>
              <div className={`text-sm font-medium ${t.colors.text}`}>Audio feedback</div>
              <div className={`text-xs ${t.colors.textMuted}`}>Play sounds when listening starts and stops</div>
            </div>
            <Toggle checked={settings.audioFeedback} onChange={(v) => update({ audioFeedback: v })} />
          </div>

          {/* ── Privacy: show mic indicator ── */}
          <div className={`flex items-center justify-between p-3 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div>
              <div className={`text-sm font-medium ${t.colors.text}`}>Show microphone indicator</div>
              <div className={`text-xs ${t.colors.textMuted}`}>Display mic status in the top bar when active</div>
            </div>
            <Toggle checked={settings.showMicIndicator} onChange={(v) => update({ showMicIndicator: v })} />
          </div>

          {/* ── Privacy: auto-pause sensitive apps ── */}
          <div className={`p-4 ${t.colors.bgSecondary} ${t.borderRadius}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className={`text-sm font-medium ${t.colors.text}`}>Auto-pause in sensitive apps</div>
                <div className={`text-xs ${t.colors.textMuted}`}>
                  Automatically mute when banking, password managers, or other sensitive apps are focused
                </div>
              </div>
              <Toggle
                checked={settings.autoPauseSensitiveApps}
                onChange={(v) => update({ autoPauseSensitiveApps: v })}
              />
            </div>

            {settings.autoPauseSensitiveApps && (
              <>
                {/* Current list */}
                {settings.sensitiveApps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {settings.sensitiveApps.map((app) => (
                      <span
                        key={app}
                        className={`flex items-center gap-1 px-2 py-1 text-xs ${t.colors.bg} ${t.borderRadius} ${t.colors.border} border`}
                      >
                        {app}
                        <button
                          onClick={() => update({
                            sensitiveApps: settings.sensitiveApps.filter((a) => a !== app),
                          })}
                          className={`${t.colors.textMuted} hover:text-red-400`}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add defaults button */}
                {settings.sensitiveApps.length === 0 && (
                  <button
                    onClick={() => update({ sensitiveApps: [...SENSITIVE_APP_DEFAULTS] })}
                    className={`flex items-center gap-1 px-2 py-1 text-xs ${t.colors.textMuted} ${t.borderRadius} ${t.colors.border} border hover:${t.colors.text} transition-colors mb-3`}
                  >
                    <Plus size={10} /> Add common defaults
                  </button>
                )}

                {/* Add custom */}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newSensitiveApp}
                    onChange={(e) => setNewSensitiveApp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSensitiveApp.trim()) {
                        update({
                          sensitiveApps: [...settings.sensitiveApps, newSensitiveApp.trim()],
                        });
                        setNewSensitiveApp("");
                      }
                    }}
                    placeholder="App name..."
                    className={`flex-1 ${t.colors.bg} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500`}
                  />
                  <button
                    onClick={() => {
                      if (newSensitiveApp.trim()) {
                        update({
                          sensitiveApps: [...settings.sensitiveApps, newSensitiveApp.trim()],
                        });
                        setNewSensitiveApp("");
                      }
                    }}
                    disabled={!newSensitiveApp.trim()}
                    className={`px-2 py-1 ${t.borderRadius} text-xs ${t.colors.textMuted} ${t.colors.bg} ${t.colors.border} border hover:${t.colors.text} disabled:opacity-30`}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Privacy warning for always-on modes ── */}
          {settings.mode !== "push-to-talk" && (
            <div
              className={`flex gap-3 p-3 ${t.borderRadius} border`}
              style={{ borderColor: "rgba(234, 179, 8, 0.3)", background: "rgba(234, 179, 8, 0.08)" }}
            >
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: "#eab308" }} />
              <div className={`text-xs ${t.colors.textMuted}`}>
                {settings.mode === "wake-word"
                  ? "In wake word mode, your microphone stays on to listen for the wake phrase. Only the wake word is processed — other audio is discarded locally and never sent anywhere."
                  : "In continuous mode, your microphone stays on and all speech is processed. Use the mute hotkey or say the exit phrase when you're done."}
              </div>
            </div>
          )}

          {/* ── Mic test ── */}
          <div className={`p-4 ${t.borderRadius} ${t.colors.bgSecondary}`}>
            <h3 className={`font-medium mb-1 ${t.colors.text}`}>Test Microphone</h3>
            <p className={`text-sm ${t.colors.textMuted} mb-3`}>
              Make sure your microphone is working correctly.
            </p>

            {testingMic && (
              <div className="mb-3">
                <div className={`w-full h-2 ${t.colors.bg} ${t.borderRadius} overflow-hidden`}>
                  <div
                    className="h-full bg-green-500 transition-all duration-100"
                    style={{ width: `${testLevel}%` }}
                  />
                </div>
                <p className={`text-xs ${t.colors.textMuted} mt-1`}>Speak now — testing for 5 seconds...</p>
              </div>
            )}

            <button
              onClick={startMicTest}
              disabled={testingMic}
              className={`${t.colors.accent} text-white hover:opacity-80 transition-colors px-4 py-2 ${t.borderRadius} text-sm disabled:opacity-50`}
            >
              {testingMic ? "Testing..." : "Start Test"}
            </button>
          </div>

          {/* ── Current status ── */}
          <div className={`p-3 ${t.colors.bgSecondary} ${t.borderRadius} flex items-center justify-between`}>
            <div className={`text-xs ${t.colors.textMuted}`}>
              Current status: <span className={`font-medium ${t.colors.text}`}>{voiceState}</span>
              {isMuted && <span className="text-red-400 ml-1">(muted)</span>}
            </div>
            <button
              onClick={toggleMute}
              className={`flex items-center gap-1 px-2 py-1 text-xs ${t.borderRadius} ${
                isMuted ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"
              }`}
            >
              {isMuted ? <MicOff size={12} /> : <Mic size={12} />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VoiceSettings;