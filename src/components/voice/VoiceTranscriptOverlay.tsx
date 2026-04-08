// ============================================================
// VoiceTranscriptOverlay.tsx
// ============================================================
// Shows real-time transcript above the chat input while recording.
// Used in push-to-talk mode — appears while user holds the button.
//
// Path: src/components/voice/VoiceTranscriptOverlay.tsx

import { Mic } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { useVoiceStore } from "../../stores/voiceStore";

function VoiceTranscriptOverlay() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { voiceState, transcript } = useVoiceStore();

  // Only show when actively listening (push-to-talk or after wake word)
  if (voiceState !== "listening") return null;

  return (
    <div
      className={`flex items-start gap-2 px-4 py-3 ${t.colors.bgSecondary} ${t.borderRadius} border ${t.colors.border} mb-2 animate-in fade-in slide-in-from-bottom-2 duration-150`}
    >
      <div className="relative flex-shrink-0 mt-0.5">
        <Mic size={16} className="text-green-400" />
        <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-green-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${t.colors.textMuted} mb-0.5`}>Listening...</div>
        <div className={`text-sm ${t.colors.text} ${!transcript ? "italic opacity-50" : ""}`}>
          {transcript || "Start speaking..."}
        </div>
      </div>
      <div className={`text-[10px] ${t.colors.textMuted} flex-shrink-0 mt-0.5`}>
        Release to send
      </div>
    </div>
  );
}

export default VoiceTranscriptOverlay;