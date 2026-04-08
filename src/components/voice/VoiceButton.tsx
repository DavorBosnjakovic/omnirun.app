// ============================================================
// VoiceButton.tsx
// ============================================================
// Push-to-talk / voice mode button for chat input areas.
// Sits next to the Attach and Send buttons in ChatArea and AssistantChatArea.
//
// Path: src/components/voice/VoiceButton.tsx

import { useState, useRef, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { useVoiceStore } from "../../stores/voiceStore";

interface VoiceButtonProps {
  /** Called when push-to-talk finishes and has a transcript to send */
  onTranscript: (text: string) => void;
  /** Whether the chat is currently loading/waiting for AI */
  disabled?: boolean;
}

function VoiceButton({ onTranscript, disabled = false }: VoiceButtonProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const {
    settings,
    voiceState,
    transcript,
    isMuted,
    isAvailable,
    startPushToTalk,
    stopPushToTalk,
  } = useVoiceStore();

  const [isHolding, setIsHolding] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Don't render if voice is disabled or not available
  if (!settings.enabled || !isAvailable) return null;

  const isListening = voiceState === "listening" && isHolding;

  // ── Push-to-talk handlers ──

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || isMuted || settings.mode !== "push-to-talk") return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsHolding(true);
    startPushToTalk();
  }, [disabled, isMuted, settings.mode, startPushToTalk]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isHolding) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsHolding(false);
    const result = stopPushToTalk();
    if (result.trim()) {
      onTranscript(result);
    }
  }, [isHolding, stopPushToTalk, onTranscript]);

  const handlePointerCancel = useCallback(() => {
    if (isHolding) {
      setIsHolding(false);
      stopPushToTalk();
    }
  }, [isHolding, stopPushToTalk]);

  // ── Keyboard support: hold Space on the button ──

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === " " && !isHolding && settings.mode === "push-to-talk") {
      e.preventDefault();
      setIsHolding(true);
      startPushToTalk();
    }
  }, [isHolding, settings.mode, startPushToTalk]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === " " && isHolding) {
      e.preventDefault();
      setIsHolding(false);
      const result = stopPushToTalk();
      if (result.trim()) {
        onTranscript(result);
      }
    }
  }, [isHolding, stopPushToTalk, onTranscript]);

  // ── Render ──

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      disabled={disabled || isMuted}
      className={`self-end p-2 ${t.borderRadius} transition-all ${
        isListening
          ? "text-green-400 bg-green-500/15 scale-110"
          : isMuted
            ? `text-red-400 opacity-50 cursor-not-allowed`
            : `${t.colors.textMuted} hover:${t.colors.text}`
      } disabled:opacity-50`}
      title={
        isMuted
          ? `Muted (press ${settings.muteHotkey} to unmute)`
          : settings.mode === "push-to-talk"
            ? "Hold to talk"
            : "Voice active"
      }
    >
      {isMuted ? <MicOff size={18} /> : <Mic size={18} />}

      {/* Pulse ring when listening */}
      {isListening && (
        <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-30 pointer-events-none" />
      )}
    </button>
  );
}

export default VoiceButton;