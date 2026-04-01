import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

function VoiceSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [alwaysListening, setAlwaysListening] = useState(false);
  const [wakeWord, setWakeWord] = useState("Hey omnirun");
  const [hotkey, setHotkey] = useState("Ctrl + Shift + Space");

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-2">Voice Settings</h1>
      <p className={`${t.colors.textMuted} mb-6`}>
        Control how you interact with omnirun using your voice.
      </p>

      {/* Enable voice */}
      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <span className="font-medium">Enable voice input</span>
            <p className={`text-sm ${t.colors.textMuted}`}>Use your microphone to talk to Claude</p>
          </div>
        </label>
      </div>

      {voiceEnabled && (
        <>
          {/* Push to talk hotkey */}
          <div className="mb-6">
            <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
              Push-to-Talk Hotkey
            </label>
            <div className="flex gap-2 max-w-xs">
              <input
                type="text"
                value={hotkey}
                onChange={(e) => setHotkey(e.target.value)}
                className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
                placeholder="Press keys..."
                onKeyDown={(e) => {
                  e.preventDefault();
                  const keys = [];
                  if (e.ctrlKey) keys.push("Ctrl");
                  if (e.shiftKey) keys.push("Shift");
                  if (e.altKey) keys.push("Alt");
                  if (e.key !== "Control" && e.key !== "Shift" && e.key !== "Alt") {
                    keys.push(e.key.charAt(0).toUpperCase() + e.key.slice(1));
                  }
                  if (keys.length > 0) setHotkey(keys.join(" + "));
                }}
              />
            </div>
            <p className={`text-sm mt-1 ${t.colors.textMuted}`}>
              Hold this key combination to speak
            </p>
          </div>

          {/* Always listening */}
          <div className="mb-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={alwaysListening}
                onChange={(e) => setAlwaysListening(e.target.checked)}
                className="w-4 h-4"
              />
              <div>
                <span className="font-medium">Always-on listening</span>
                <p className={`text-sm ${t.colors.textMuted}`}>Listen for wake word without pressing a button</p>
              </div>
            </label>
          </div>

          {/* Wake word */}
          {alwaysListening && (
            <div className="mb-6">
              <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
                Wake Word
              </label>
              <select
                value={wakeWord}
                onChange={(e) => setWakeWord(e.target.value)}
                className={`w-full max-w-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
              >
                <option value="Hey omnirun">Hey omnirun</option>
                <option value="Hey Dev">Hey Dev</option>
                <option value="Computer">Computer</option>
              </select>
            </div>
          )}

          {/* Audio feedback */}
          <div className="mb-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                defaultChecked
                className="w-4 h-4"
              />
              <div>
                <span className="font-medium">Audio feedback</span>
                <p className={`text-sm ${t.colors.textMuted}`}>Play sounds when listening starts/stops</p>
              </div>
            </label>
          </div>

          {/* Test microphone */}
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4`}>
            <h3 className="font-medium mb-2">Test Microphone</h3>
            <p className={`text-sm ${t.colors.textMuted} mb-3`}>
              Make sure your microphone is working correctly.
            </p>
            <button
              className={`${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} px-4 py-2 ${t.borderRadius}`}
            >
              Start Test
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default VoiceSettings;