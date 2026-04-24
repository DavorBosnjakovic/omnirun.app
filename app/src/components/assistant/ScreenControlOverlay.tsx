// ============================================================
// ScreenControlOverlay.tsx
// ============================================================
// Floating bar displayed when AI is actively controlling the screen.
// Shows current status, step count, and a prominent Stop button.
// Rendered by AssistantSection when screen control is in progress.
//
// Design: fixed position at top-center, semi-transparent dark bar,
// always on top so the user can stop at any time.

import { useState, useEffect } from "react";
import { Monitor, Square, Eye, MousePointer, Keyboard, Loader2 } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

export type ScreenControlStatus =
  | "capturing"     // Taking a screenshot
  | "analyzing"     // AI is reading the screenshot
  | "acting"        // Executing a mouse/keyboard action
  | "waiting"       // WAIT action in progress
  | "paused"        // Paused for user approval (sensitive action)
  | "idle";         // Between steps

interface ScreenControlOverlayProps {
  status: ScreenControlStatus;
  stepCount: number;
  currentAction?: string;   // e.g. "CLICK 450 230", "TYPE hello", "Analyzing screen..."
  onStop: () => void;
}

const STATUS_CONFIG: Record<ScreenControlStatus, { icon: any; label: string }> = {
  capturing:  { icon: Eye,          label: "Capturing screen" },
  analyzing:  { icon: Loader2,      label: "Reading screen" },
  acting:     { icon: MousePointer,  label: "Performing action" },
  waiting:    { icon: Loader2,      label: "Waiting" },
  paused:     { icon: Monitor,      label: "Paused — approval needed" },
  idle:       { icon: Monitor,      label: "Screen control active" },
};

function ScreenControlOverlay({ status, stepCount, currentAction, onStop }: ScreenControlOverlayProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const StatusIcon = config.icon;
  const isSpinning = status === "analyzing" || status === "waiting";

  // Pulse animation for the green dot
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => setPulse((p) => !p), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl border backdrop-blur-md"
      style={{
        background: "rgba(15, 15, 20, 0.92)",
        borderColor: "rgba(45, 184, 122, 0.3)",
        minWidth: 340,
        maxWidth: 520,
      }}
    >
      {/* Green pulse dot */}
      <div className="relative flex-shrink-0">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: "#2DB87A" }}
        />
        {pulse && (
          <div
            className="absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping"
            style={{ background: "#2DB87A", opacity: 0.4 }}
          />
        )}
      </div>

      {/* Status icon */}
      <StatusIcon
        size={16}
        className={`flex-shrink-0 ${isSpinning ? "animate-spin" : ""}`}
        style={{ color: "#2DB87A" }}
      />

      {/* Status text */}
      <div className="flex-1 min-w-0">
        <div className="text-white text-xs font-medium truncate">
          {config.label}
          {stepCount > 0 && (
            <span className="text-white/50 ml-1.5">
              · Step {stepCount}
            </span>
          )}
        </div>
        {currentAction && (
          <div className="text-white/40 text-[10px] truncate mt-0.5">
            {currentAction}
          </div>
        )}
      </div>

      {/* Stop button */}
      <button
        onClick={onStop}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors flex-shrink-0"
        style={{ background: "rgba(239, 68, 68, 0.9)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 1)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.9)")}
      >
        <Square size={12} fill="currentColor" />
        Stop
      </button>
    </div>
  );
}

export default ScreenControlOverlay;