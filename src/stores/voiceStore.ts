// ============================================================
// voiceStore.ts
// ============================================================
// Zustand store for voice control state.
// Connects voiceService callbacks to reactive UI state.
// Handles voice command parsing (navigation, feature toggles).
// Supports consecutive commands in a single utterance.
//
// Path: src/stores/voiceStore.ts

import { create } from "zustand";
import {
  type VoiceMode,
  type VoiceState,
  type VoiceSettings,
  loadVoiceSettings,
  saveVoiceSettings,
  setVoiceCallbacks,
  applyVoiceSettings,
  startPushToTalk,
  stopPushToTalk,
  startContinuousMode,
  startWakeWordMode,
  stopAll,
  toggleMute as toggleMuteService,
  registerMuteHotkey,
  unregisterMuteHotkey,
  isSpeechAvailable,
  checkSensitiveApp,
} from "../services/voiceService";

// ── Voice command patterns ───────────────────────────────────

interface CommandMatch {
  type: "navigate" | "screen_control" | "settings";
  section?: string;
  action?: string;
  label: string; // Human-readable feedback for the modal
  pattern: RegExp;
}

const COMMAND_PATTERNS: CommandMatch[] = [
  // ── Navigation ──
  { pattern: /\b(?:switch|go|navigate|open)\s*(?:to\s+)?(?:the\s+)?home\b/i, type: "navigate", section: "home", label: "Going to Home" },
  { pattern: /\b(?:go|switch)\s*(?:to\s+)?(?:the\s+)?dashboard\b/i, type: "navigate", section: "home", label: "Going to Home" },
  { pattern: /\bgo\s+home\b/i, type: "navigate", section: "home", label: "Going to Home" },
  { pattern: /\b(?:switch|go|navigate|open)\s*(?:to\s+)?(?:the\s+)?projects?\b/i, type: "navigate", section: "projects", label: "Going to Projects" },
  { pattern: /\b(?:switch|go|navigate|open)\s*(?:to\s+)?(?:the\s+)?assistant\b/i, type: "navigate", section: "assistant", label: "Going to Assistant" },
  { pattern: /\b(?:switch|go|navigate|open)\s*(?:to\s+)?(?:the\s+)?(?:scheduled\s+)?tasks?\b/i, type: "navigate", section: "tasks", label: "Going to Tasks" },

  // ── Screen control ──
  { pattern: /\b(?:turn|switch|enable)\s+on\s+screen\s*(?:control)?\b/i, type: "screen_control", action: "on", label: "Activating Screen Control" },
  { pattern: /\b(?:start|activate|begin)\s+screen\s*(?:control)?\b/i, type: "screen_control", action: "on", label: "Activating Screen Control" },
  { pattern: /\b(?:turn|switch|disable)\s+off\s+screen\s*(?:control)?\b/i, type: "screen_control", action: "off", label: "Stopping Screen Control" },
  { pattern: /\b(?:stop|deactivate|end)\s+screen\s*(?:control)?\b/i, type: "screen_control", action: "off", label: "Stopping Screen Control" },
  { pattern: /\bscreen\s*(?:control)?\s+on\b/i, type: "screen_control", action: "on", label: "Activating Screen Control" },
  { pattern: /\bscreen\s*(?:control)?\s+off\b/i, type: "screen_control", action: "off", label: "Stopping Screen Control" },
  { pattern: /\b(?:take\s+)?control\s+(?:of\s+)?(?:my\s+)?(?:the\s+)?(?:screen|computer|desktop)\b/i, type: "screen_control", action: "on", label: "Activating Screen Control" },

  // ── Settings ──
  { pattern: /\b(?:open|go\s+to|show)\s+voice\s+settings\b/i, type: "settings", action: "voice", label: "Opening Voice Settings" },
  { pattern: /\b(?:open|go\s+to|show)\s+settings\b/i, type: "settings", action: "general", label: "Opening Settings" },
];

function extractCommands(text: string): { commands: CommandMatch[]; remaining: string } {
  let remaining = text;
  const commands: CommandMatch[] = [];

  for (const cmd of COMMAND_PATTERNS) {
    if (cmd.pattern.test(remaining)) {
      commands.push(cmd);
      remaining = remaining.replace(cmd.pattern, "").trim();
      remaining = remaining.replace(/^[,.\s]+|[,.\s]+$/g, "").replace(/^(?:and|then|also|plus)\s+/i, "").trim();
    }
  }

  return { commands, remaining };
}

// ── Store ────────────────────────────────────────────────────

interface PendingCommand {
  type: string;
  action?: string;
  timestamp: number;
}

interface VoiceStore {
  // State
  settings: VoiceSettings;
  voiceState: VoiceState;
  transcript: string;
  isFinal: boolean;
  isMuted: boolean;
  error: string | null;
  isAvailable: boolean;
  sensitiveAppPaused: boolean;

  // Command feedback — shown in modal after command executes
  commandFeedback: string | null;
  lastTranscript: string | null;

  // Pending command (for cross-component communication)
  pendingCommand: PendingCommand | null;
  clearPendingCommand: () => void;

  // Settings
  updateSettings: (partial: Partial<VoiceSettings>) => void;

  // Actions
  init: () => void;
  startPushToTalk: () => void;
  stopPushToTalk: () => Promise<string>;
  startContinuous: () => void;
  startWakeWord: () => void;
  stop: () => void;
  toggleMute: () => void;
  clearError: () => void;
  clearTranscript: () => void;

  /** Try to handle text as voice command(s). Returns true if any command found. */
  tryVoiceCommand: (text: string) => boolean;

  // Auto-send callback — set by ChatArea/AssistantChatArea
  onAutoSend: ((text: string) => void) | null;
  setOnAutoSend: (cb: ((text: string) => void) | null) => void;

  // Navigation callback — set by MainLayout
  onNavigate: ((section: string) => void) | null;
  setOnNavigate: (cb: ((section: string) => void) | null) => void;

  // Settings callback — set by MainLayout
  onOpenSettings: ((tab: string) => void) | null;
  setOnOpenSettings: (cb: ((tab: string) => void) | null) => void;
}

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => {
  let sensitiveAppInterval: ReturnType<typeof setInterval> | null = null;

  return {
    settings: loadVoiceSettings(),
    voiceState: "idle",
    transcript: "",
    isFinal: false,
    isMuted: false,
    error: null,
    isAvailable: isSpeechAvailable(),
    sensitiveAppPaused: false,
    onAutoSend: null,
    onNavigate: null,
    onOpenSettings: null,
    pendingCommand: null,
    commandFeedback: null,
    lastTranscript: null,

    setOnAutoSend: (cb) => set({ onAutoSend: cb }),
    setOnNavigate: (cb) => set({ onNavigate: cb }),
    setOnOpenSettings: (cb) => set({ onOpenSettings: cb }),
    clearPendingCommand: () => set({ pendingCommand: null }),

    tryVoiceCommand: (text: string): boolean => {
      const { commands, remaining } = extractCommands(text);

      if (commands.length === 0) return false;

      const { onNavigate, onOpenSettings } = get();

      // Build feedback string from all commands
      const feedbackParts = commands.map((c) => c.label);
      const feedbackStr = feedbackParts.join(" → ");

      // Show transcript + feedback in the modal
      if (feedbackTimer) clearTimeout(feedbackTimer);
      set({
        lastTranscript: text,
        commandFeedback: feedbackStr,
        transcript: text,
        isFinal: true,
      });

      // Clear feedback after 3 seconds
      feedbackTimer = setTimeout(() => {
        set({ commandFeedback: null, lastTranscript: null, transcript: "", isFinal: false });
        feedbackTimer = null;
      }, 3000);

      // Execute all commands in order
      for (const cmd of commands) {
        if (cmd.type === "navigate" && cmd.section && onNavigate) {
          onNavigate(cmd.section);
        }

        if (cmd.type === "screen_control") {
          if (onNavigate) onNavigate("assistant");
          setTimeout(() => {
            set({
              pendingCommand: {
                type: "screen_control",
                action: cmd.action,
                timestamp: Date.now(),
              },
            });
          }, 300);
        }

        if (cmd.type === "settings" && onOpenSettings) {
          onOpenSettings(cmd.action || "general");
        }
      }

      // If there's remaining text after commands, send it to chat
      if (remaining.length > 3) {
        setTimeout(() => {
          const { onAutoSend } = get();
          if (onAutoSend) onAutoSend(remaining);
        }, 600);
      }

      return true;
    },

    updateSettings: (partial) => {
      const newSettings = { ...get().settings, ...partial };
      set({ settings: newSettings });
      saveVoiceSettings(newSettings);
      applyVoiceSettings(newSettings);

      if (partial.muteHotkey) {
        registerMuteHotkey(partial.muteHotkey);
      }
    },

    init: () => {
      const settings = loadVoiceSettings();
      set({ settings, isAvailable: isSpeechAvailable() });

      setVoiceCallbacks({
        onTranscriptUpdate: (text, isFinal) => {
          set({ transcript: text, isFinal });
        },
        onStateChange: (state) => {
          set({ voiceState: state, isMuted: state === "muted" });
        },
        onError: (error) => {
          set({ error });
        },
        onAutoSend: (text) => {
          const { tryVoiceCommand, onAutoSend } = get();
          if (tryVoiceCommand(text)) return;
          if (onAutoSend) onAutoSend(text);
          set({ transcript: "", isFinal: false });
        },
        onWakeWordDetected: () => {},
        onContinuousExit: () => {
          set({ voiceState: "idle", transcript: "", isFinal: false });
        },
      });

      applyVoiceSettings(settings);

      if (settings.enabled) {
        registerMuteHotkey(settings.muteHotkey);
      }

      if (settings.autoPauseSensitiveApps) {
        sensitiveAppInterval = setInterval(async () => {
          const s = get().settings;
          if (!s.enabled || !s.autoPauseSensitiveApps) return;
          const isSensitive = await checkSensitiveApp();
          const { sensitiveAppPaused } = get();
          if (isSensitive && !sensitiveAppPaused) {
            stopAll();
            set({ sensitiveAppPaused: true, voiceState: "muted" });
          } else if (!isSensitive && sensitiveAppPaused) {
            set({ sensitiveAppPaused: false });
            const mode = get().settings.mode;
            if (mode === "wake-word") startWakeWordMode();
            else if (mode === "continuous") startContinuousMode();
            else set({ voiceState: "idle" });
          }
        }, 3000);
      }

      // Start muted by default — user clicks topbar indicator to unmute
      stopAll();
      set({ isMuted: true, voiceState: "muted" });
    },

    startPushToTalk: () => {
      if (get().isMuted || !get().settings.enabled) return;
      set({ transcript: "", isFinal: false, error: null });
      startPushToTalk();
    },

    stopPushToTalk: async () => {
      const result = await stopPushToTalk();
      set({ transcript: result, isFinal: true });
      return result;
    },

    startContinuous: () => {
      if (get().isMuted || !get().settings.enabled) return;
      set({ transcript: "", isFinal: false, error: null });
      startContinuousMode();
    },

    startWakeWord: () => {
      if (get().isMuted || !get().settings.enabled) return;
      set({ transcript: "", isFinal: false, error: null });
      startWakeWordMode();
    },

    stop: () => {
      stopAll();
      set({ transcript: "", isFinal: false });
    },

    toggleMute: () => {
      const newMuted = toggleMuteService();
      set({ isMuted: newMuted });
    },

    clearError: () => set({ error: null }),
    clearTranscript: () => set({ transcript: "", isFinal: false }),
  };
});