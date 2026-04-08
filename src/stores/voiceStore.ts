// ============================================================
// voiceStore.ts
// ============================================================
// Zustand store for voice control state.
// Connects voiceService callbacks to reactive UI state.
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

  // Settings
  updateSettings: (partial: Partial<VoiceSettings>) => void;

  // Actions
  init: () => void;
  startPushToTalk: () => void;
  stopPushToTalk: () => string;
  startContinuous: () => void;
  startWakeWord: () => void;
  stop: () => void;
  toggleMute: () => void;
  clearError: () => void;
  clearTranscript: () => void;

  // Auto-send callback — set by ChatArea/AssistantChatArea
  onAutoSend: ((text: string) => void) | null;
  setOnAutoSend: (cb: ((text: string) => void) | null) => void;
}

export const useVoiceStore = create<VoiceStore>((set, get) => {
  // Sensitive app check interval
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

    setOnAutoSend: (cb) => set({ onAutoSend: cb }),

    updateSettings: (partial) => {
      const newSettings = { ...get().settings, ...partial };
      set({ settings: newSettings });
      saveVoiceSettings(newSettings);
      applyVoiceSettings(newSettings);

      // Re-register hotkey if it changed
      if (partial.muteHotkey) {
        registerMuteHotkey(partial.muteHotkey);
      }
    },

    init: () => {
      const settings = loadVoiceSettings();
      set({ settings, isAvailable: isSpeechAvailable() });

      // Wire up service callbacks → store state
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
          const { onAutoSend } = get();
          if (onAutoSend) {
            onAutoSend(text);
          }
          set({ transcript: "", isFinal: false });
        },
        onWakeWordDetected: () => {
          // Could trigger UI flash or sound — handled by VoiceIndicator
        },
        onContinuousExit: () => {
          set({ voiceState: "idle", transcript: "", isFinal: false });
        },
      });

      applyVoiceSettings(settings);

      // Register global mute hotkey
      if (settings.enabled) {
        registerMuteHotkey(settings.muteHotkey);
      }

      // Auto-start wake-word mode if configured
      if (settings.enabled && settings.mode === "wake-word") {
        startWakeWordMode();
      }

      // Sensitive app polling (every 3 seconds)
      if (settings.autoPauseSensitiveApps) {
        sensitiveAppInterval = setInterval(async () => {
          const s = get().settings;
          if (!s.enabled || !s.autoPauseSensitiveApps) return;
          const isSensitive = await checkSensitiveApp();
          const { sensitiveAppPaused, voiceState } = get();
          if (isSensitive && !sensitiveAppPaused) {
            // Pause
            stopAll();
            set({ sensitiveAppPaused: true, voiceState: "muted" });
          } else if (!isSensitive && sensitiveAppPaused) {
            // Resume
            set({ sensitiveAppPaused: false });
            const mode = get().settings.mode;
            if (mode === "wake-word") startWakeWordMode();
            else if (mode === "continuous") startContinuousMode();
            else set({ voiceState: "idle" });
          }
        }, 3000);
      }
    },

    startPushToTalk: () => {
      if (get().isMuted || !get().settings.enabled) return;
      set({ transcript: "", isFinal: false, error: null });
      startPushToTalk();
    },

    stopPushToTalk: () => {
      const result = stopPushToTalk();
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