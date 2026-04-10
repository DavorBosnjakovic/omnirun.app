// ============================================================
// VoiceCommandModal.tsx
// ============================================================
// Floating overlay that appears when voice is active.
// Shows listening state, transcript, and command feedback.
// Replaces the old VoiceIndicator in the topbar.
//
// Path: src/components/voice/VoiceCommandModal.tsx

import { useEffect, useState, useRef } from "react";
import { Mic, Ear, Loader2, ArrowRight } from "lucide-react";
import { useVoiceStore } from "../../stores/voiceStore";

function VoiceCommandModal() {
  const {
    settings,
    voiceState,
    transcript,
    commandFeedback,
    lastTranscript,
  } = useVoiceStore();

  const [visible, setVisible] = useState(false);
  const [animatingOut, setAnimatingOut] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStateRef = useRef(voiceState);

  // Show/hide logic
  useEffect(() => {
    const isActive =
      voiceState === "listening" ||
      voiceState === "processing";

    const hasCommandFeedback = !!commandFeedback;

    if (isActive && !visible) {
      // Show modal
      setAnimatingOut(false);
      setVisible(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }

    // Show briefly for command feedback even after returning to wake-listening
    if (hasCommandFeedback && !visible) {
      setAnimatingOut(false);
      setVisible(true);
    }

    // When going from active to wake-listening/idle — start hide timer
    if (
      (prevStateRef.current === "listening" || prevStateRef.current === "processing") &&
      (voiceState === "wake-listening" || voiceState === "idle")
    ) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setAnimatingOut(true);
        setTimeout(() => {
          setVisible(false);
          setAnimatingOut(false);
        }, 300);
        hideTimerRef.current = null;
      }, commandFeedback ? 2500 : 800);
    }

    // Hide when muted
    if (voiceState === "muted") {
      setVisible(false);
    }

    prevStateRef.current = voiceState;
  }, [voiceState, commandFeedback]);

  // Auto-hide after command feedback clears
  useEffect(() => {
    if (!commandFeedback && visible && voiceState === "wake-listening") {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setAnimatingOut(true);
        setTimeout(() => {
          setVisible(false);
          setAnimatingOut(false);
        }, 300);
        hideTimerRef.current = null;
      }, 500);
    }
  }, [commandFeedback]);

  if (!settings.enabled) return null;
  if (!visible) return null;
  if (settings.mode === "push-to-talk") return null; // Push-to-talk has VoiceTranscriptOverlay

  const isListening = voiceState === "listening";
  const isProcessing = voiceState === "processing";
  const displayText = lastTranscript || transcript;

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[9998] transition-all duration-300 ${
        animatingOut ? "opacity-0 -translate-y-4" : "opacity-100 translate-y-0"
      }`}
      style={{ minWidth: 320, maxWidth: 500 }}
    >
      <div
        className="rounded-2xl shadow-2xl border backdrop-blur-md px-5 py-4"
        style={{
          background: commandFeedback
            ? "rgba(15, 25, 15, 0.95)"
            : isListening
              ? "rgba(15, 20, 15, 0.95)"
              : isProcessing
                ? "rgba(20, 15, 25, 0.95)"
                : "rgba(15, 15, 20, 0.92)",
          borderColor: commandFeedback
            ? "rgba(34, 197, 94, 0.4)"
            : isListening
              ? "rgba(34, 197, 94, 0.3)"
              : isProcessing
                ? "rgba(168, 85, 247, 0.3)"
                : "rgba(96, 165, 250, 0.2)",
        }}
      >
        {/* Status row */}
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            {commandFeedback ? (
              <ArrowRight size={20} className="text-green-400" />
            ) : isListening ? (
              <>
                <Mic size={20} className="text-green-400" />
                <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-green-400" />
              </>
            ) : isProcessing ? (
              <Loader2 size={20} className="text-purple-400 animate-spin" />
            ) : (
              <Ear size={20} className="text-blue-400" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-medium">
              {commandFeedback
                ? commandFeedback
                : isListening
                  ? "Listening..."
                  : isProcessing
                    ? "Transcribing..."
                    : 'Say "Hey Omni"'}
            </div>
          </div>

          <div className="text-white/30 text-[10px] flex-shrink-0">
            {settings.muteHotkey} to mute
          </div>
        </div>

        {/* Transcript text */}
        {displayText && (isListening || isProcessing || commandFeedback) && (
          <div className="mt-2.5 px-1">
            <div className={`text-sm ${commandFeedback ? "text-white/60" : "text-white/90"}`}>
              {displayText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default VoiceCommandModal;