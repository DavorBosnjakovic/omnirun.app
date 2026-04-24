// ============================================================
// VoiceButton.tsx
// ============================================================
// Push-to-talk / voice mode button for chat input areas.
// Sits next to the Attach and Send buttons in ChatArea and AssistantChatArea.
//
// Path: src/components/voice/VoiceButton.tsx

import { useState, useCallback } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
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
    isMuted,
    isAvailable,
    startPushToTalk,
    stopPushToTalk,
    tryVoiceCommand,
  } = useVoiceStore();

  const [isHolding, setIsHolding] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  if (!settings.enabled || !isAvailable) return null;

  const isListening = voiceState === "listening" && isHolding;

  // ── Push-to-talk handlers ──

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || isMuted || isTranscribing || settings.mode !== "push-to-talk") return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsHolding(true);
    startPushToTalk();
  }, [disabled, isMuted, isTranscribing, settings.mode, startPushToTalk]);

  const handlePointerUp = useCallback(async (e: React.PointerEvent) => {
    if (!isHolding) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsHolding(false);
    setIsTranscribing(true);

    try {
      const result = await stopPushToTalk();
      if (result.trim()) {
        // Check for voice commands (navigation) before sending to chat
        if (!tryVoiceCommand(result)) {
          onTranscript(result);
        }
      }
    } finally {
      setIsTranscribing(false);
    }
  }, [isHolding, stopPushToTalk, onTranscript, tryVoiceCommand]);

  const handlePointerCancel = useCallback(async () => {
    if (isHolding) {
      setIsHolding(false);
      setIsTranscribing(true);
      try {
        await stopPushToTalk();
      } finally {
        setIsTranscribing(false);
      }
    }
  }, [isHolding, stopPushToTalk]);

  // ── Keyboard support: hold Space on the button ──

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === " " && !isHolding && !isTranscribing && settings.mode === "push-to-talk") {
      e.preventDefault();
      setIsHolding(true);
      startPushToTalk();
    }
  }, [isHolding, isTranscribing, settings.mode, startPushToTalk]);

  const handleKeyUp = useCallback(async (e: React.KeyboardEvent) => {
    if (e.key === " " && isHolding) {
      e.preventDefault();
      setIsHolding(false);
      setIsTranscribing(true);
      try {
        const result = await stopPushToTalk();
        if (result.trim()) {
          if (!tryVoiceCommand(result)) {
            onTranscript(result);
          }
        }
      } finally {
        setIsTranscribing(false);
      }
    }
  }, [isHolding, stopPushToTalk, onTranscript, tryVoiceCommand]);

  // ── Render ──

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      disabled={disabled || isMuted || isTranscribing}
      className={`relative self-end p-2 ${t.borderRadius} transition-all ${
        isTranscribing
          ? "text-purple-400 bg-purple-500/10"
          : isListening
            ? "text-green-400 bg-green-500/15 scale-110"
            : isMuted
              ? "text-red-400 opacity-50 cursor-not-allowed"
              : `${t.colors.textMuted} hover:${t.colors.text}`
      } disabled:opacity-50`}
      title={
        isTranscribing
          ? "Transcribing..."
          : isMuted
            ? `Muted (press ${settings.muteHotkey} to unmute)`
            : settings.mode === "push-to-talk"
              ? "Hold to talk"
              : "Voice active"
      }
    >
      {isTranscribing ? (
        <Loader2 size={18} className="animate-spin" />
      ) : isMuted ? (
        <MicOff size={18} />
      ) : (
        <Mic size={18} />
      )}

      {/* Pulse ring when listening */}
      {isListening && (
        <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-30 pointer-events-none" />
      )}
    </button>
  );
}

export default VoiceButton;