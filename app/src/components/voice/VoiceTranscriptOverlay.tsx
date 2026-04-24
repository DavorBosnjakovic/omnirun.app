// ============================================================
// VoiceTranscriptOverlay.tsx
// ============================================================
// Shows real-time status above the chat input while recording.
// Used in push-to-talk mode and after wake word detection.
//
// Path: src/components/voice/VoiceTranscriptOverlay.tsx

import { Mic, Loader2 } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { useVoiceStore } from "../../stores/voiceStore";

function VoiceTranscriptOverlay() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { voiceState, transcript } = useVoiceStore();

  // Show when actively listening or processing (transcribing)
  if (voiceState !== "listening" && voiceState !== "processing") return null;

  const isProcessing = voiceState === "processing";

  return (
    <div
      className={`flex items-start gap-2 px-4 py-3 ${t.colors.bgSecondary} ${t.borderRadius} border ${t.colors.border} mb-2 animate-in fade-in slide-in-from-bottom-2 duration-150`}
    >
      <div className="relative flex-shrink-0 mt-0.5">
        {isProcessing ? (
          <Loader2 size={16} className="text-purple-400 animate-spin" />
        ) : (
          <>
            <Mic size={16} className="text-green-400" />
            <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-green-400" />
          </>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${t.colors.textMuted} mb-0.5`}>
          {isProcessing ? "Transcribing..." : "Listening..."}
        </div>
        <div className={`text-sm ${t.colors.text} ${!transcript ? "italic opacity-50" : ""}`}>
          {transcript || (isProcessing ? "Processing audio..." : "Start speaking...")}
        </div>
      </div>
      {!isProcessing && (
        <div className={`text-[10px] ${t.colors.textMuted} flex-shrink-0 mt-0.5`}>
          Release to send
        </div>
      )}
    </div>
  );
}

export default VoiceTranscriptOverlay;