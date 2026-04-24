// ============================================================
// VoiceIndicator.tsx
// ============================================================
// Global microphone status indicator.
// Shows in the topbar area — visible at all times when voice is active.
// States: wake-listening (dim), listening (green pulse), processing, muted (red).
//
// Path: src/components/voice/VoiceIndicator.tsx

import { Mic, MicOff, Ear } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { useVoiceStore } from "../../stores/voiceStore";

function VoiceIndicator() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { settings, voiceState, isMuted, transcript, sensitiveAppPaused, toggleMute } = useVoiceStore();

  if (!settings.enabled || !settings.showMicIndicator) return null;
  if (settings.mode === "push-to-talk" && voiceState === "idle") return null;

  const stateConfig = {
    idle: {
      icon: Mic,
      color: t.colors.textMuted,
      bg: "transparent",
      pulse: false,
      label: "",
    },
    "wake-listening": {
      icon: Ear,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      pulse: false,
      label: '"Hey Omni"',
    },
    listening: {
      icon: Mic,
      color: "text-green-400",
      bg: "bg-green-500/15",
      pulse: true,
      label: "Listening...",
    },
    processing: {
      icon: Mic,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      pulse: false,
      label: "Transcribing...",
    },
    muted: {
      icon: MicOff,
      color: "text-red-400",
      bg: "bg-red-500/10",
      pulse: false,
      label: sensitiveAppPaused ? "Paused (sensitive app)" : `Muted (${settings.muteHotkey})`,
    },
  };

  const config = stateConfig[voiceState] || stateConfig.idle;
  const Icon = config.icon;

  return (
    <button
      onClick={toggleMute}
      className={`relative flex items-center gap-1.5 px-2 py-1 ${t.borderRadius} ${config.bg} ${config.color} transition-all text-xs hover:opacity-80`}
      title={`Click to ${isMuted ? "unmute" : "mute"} — or press ${settings.muteHotkey}`}
    >
      <div className="relative">
        <Icon size={14} />
        {config.pulse && (
          <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-green-400" />
        )}
      </div>

      {config.label && (
        <span className="max-w-[120px] truncate">{config.label}</span>
      )}

      {transcript && voiceState === "listening" && settings.mode !== "push-to-talk" && (
        <span className={`max-w-[150px] truncate ${t.colors.textMuted} text-[10px]`}>
          {transcript}
        </span>
      )}
    </button>
  );
}

export default VoiceIndicator;