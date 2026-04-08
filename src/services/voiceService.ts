// ============================================================
// voiceService.ts
// ============================================================
// Voice control service for Omnirun.
// Handles: push-to-talk, always-on wake word, continuous conversation.
// Uses Web Speech API (SpeechRecognition) — free, runs in Tauri WebView.
//
// Path: src/services/voiceService.ts

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ── Types ────────────────────────────────────────────────────

export type VoiceMode = "push-to-talk" | "wake-word" | "continuous";
export type VoiceState = "idle" | "listening" | "processing" | "wake-listening" | "muted";
export type VoiceLanguage = "en-US" | "en-GB" | "es-ES" | "fr-FR" | "de-DE" | "it-IT" | "pt-BR" | "ja-JP" | "ko-KR" | "zh-CN" | "nl-NL" | "ru-RU" | "sr-RS";

export interface VoiceSettings {
  enabled: boolean;
  mode: VoiceMode;
  language: VoiceLanguage;
  wakeWord: string;
  muteHotkey: string;
  audioFeedback: boolean;
  autoSendOnSilence: boolean;
  silenceTimeout: number;       // ms — how long to wait after user stops before sending
  showMicIndicator: boolean;
  autoPauseSensitiveApps: boolean;
  sensitiveApps: string[];      // app names to auto-mute in
  continuousExitPhrase: string; // phrase that exits continuous mode
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  mode: "push-to-talk",
  language: "en-US",
  wakeWord: "Hey Omnirun",
  muteHotkey: "F9",
  audioFeedback: true,
  autoSendOnSilence: true,
  silenceTimeout: 1500,
  showMicIndicator: true,
  autoPauseSensitiveApps: true,
  sensitiveApps: [],
  continuousExitPhrase: "that's all",
};

const STORAGE_KEY = "omnirun_voice_settings";

// ── Settings persistence ─────────────────────────────────────

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_VOICE_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ── SpeechRecognition setup ──────────────────────────────────

// Browser compat — works in Chromium (Tauri WebView)
const SpeechRecognition =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

let recognition: any | null = null;
let isRecognitionActive = false;

// Callbacks — set by the store/components
let onTranscriptUpdate: ((text: string, isFinal: boolean) => void) | null = null;
let onStateChange: ((state: VoiceState) => void) | null = null;
let onError: ((error: string) => void) | null = null;
let onAutoSend: ((text: string) => void) | null = null;
let onWakeWordDetected: (() => void) | null = null;
let onContinuousExit: (() => void) | null = null;

// Internal state
let currentMode: VoiceMode = "push-to-talk";
let currentSettings: VoiceSettings = DEFAULT_VOICE_SETTINGS;
let isMuted = false;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let interimTranscript = "";
let finalTranscript = "";
let wakeWordDetected = false;
let unlistenMuteHotkey: UnlistenFn | null = null;

// ── Audio feedback ───────────────────────────────────────────

const audioCtx = typeof AudioContext !== "undefined" ? new AudioContext() : null;

function playTone(frequency: number, duration: number, volume = 0.15) {
  if (!audioCtx || !currentSettings.audioFeedback) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch { /* audio not available */ }
}

function playListeningStart() { playTone(880, 0.12); }
function playListeningStop() { playTone(440, 0.12); }
function playWakeWordChime() {
  playTone(660, 0.08);
  setTimeout(() => playTone(880, 0.1), 100);
}

// ── Core recognition ─────────────────────────────────────────

function createRecognition(): any {
  if (!SpeechRecognition) {
    onError?.("Speech recognition not supported in this browser.");
    return null;
  }

  const rec = new SpeechRecognition();
  rec.lang = currentSettings.language;
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    isRecognitionActive = true;
  };

  rec.onend = () => {
    isRecognitionActive = false;

    // Auto-restart for wake-word and continuous modes (unless muted or disabled)
    if (!isMuted && currentSettings.enabled) {
      if (currentMode === "wake-word" && !wakeWordDetected) {
        // Restart listening for wake word
        startRecognitionSafe();
        onStateChange?.("wake-listening");
      } else if (currentMode === "continuous") {
        // Restart listening for next command
        startRecognitionSafe();
        onStateChange?.("listening");
      }
    } else {
      onStateChange?.(isMuted ? "muted" : "idle");
    }
  };

  rec.onerror = (event: any) => {
    const error = event.error;
    // "no-speech" and "aborted" are normal — don't report them
    if (error === "no-speech" || error === "aborted") return;
    onError?.(error);
    isRecognitionActive = false;
  };

  rec.onresult = (event: any) => {
    interimTranscript = "";
    finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;

      if (result.isFinal) {
        finalTranscript += text;
      } else {
        interimTranscript += text;
      }
    }

    const currentText = finalTranscript || interimTranscript;

    // ── Wake word detection ──
    if (currentMode === "wake-word" && !wakeWordDetected) {
      const lower = currentText.toLowerCase().trim();
      const wake = currentSettings.wakeWord.toLowerCase().trim();
      if (lower.includes(wake)) {
        wakeWordDetected = true;
        playWakeWordChime();
        onWakeWordDetected?.();
        onStateChange?.("listening");
        // Reset transcripts — don't include the wake word in the message
        interimTranscript = "";
        finalTranscript = "";
        onTranscriptUpdate?.("", false);
        // Reset the silence timer to give user time to speak after wake word
        resetSilenceTimer();
        return;
      }
      // Still waiting for wake word — show nothing in transcript
      return;
    }

    // ── Continuous mode exit phrase ──
    if (currentMode === "continuous" && finalTranscript) {
      const lower = finalTranscript.toLowerCase().trim();
      const exitPhrase = currentSettings.continuousExitPhrase.toLowerCase().trim();
      if (lower.includes(exitPhrase)) {
        stopAll();
        onContinuousExit?.();
        return;
      }
    }

    // ── Normal transcript update ──
    onTranscriptUpdate?.(currentText, !!finalTranscript);

    // ── Auto-send on silence (for wake-word after detection & continuous) ──
    if (currentMode !== "push-to-talk" && currentSettings.autoSendOnSilence) {
      resetSilenceTimer();
      if (finalTranscript) {
        silenceTimer = setTimeout(() => {
          if (finalTranscript.trim()) {
            onAutoSend?.(finalTranscript.trim());
            finalTranscript = "";
            interimTranscript = "";
            onTranscriptUpdate?.("", false);
            // In wake-word mode, go back to listening for wake word
            if (currentMode === "wake-word") {
              wakeWordDetected = false;
              onStateChange?.("wake-listening");
            }
          }
        }, currentSettings.silenceTimeout);
      }
    }
  };

  return rec;
}

function resetSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

function startRecognitionSafe() {
  if (!recognition) recognition = createRecognition();
  if (!recognition) return;

  // Update language in case it changed
  recognition.lang = currentSettings.language;

  try {
    if (!isRecognitionActive) {
      recognition.start();
    }
  } catch (e: any) {
    // "already started" — ignore
    if (!e?.message?.includes("already started")) {
      onError?.(e?.message || "Failed to start recognition");
    }
  }
}

function stopRecognitionSafe() {
  resetSilenceTimer();
  try {
    if (recognition && isRecognitionActive) {
      recognition.stop();
    }
  } catch { /* ignore */ }
  isRecognitionActive = false;
}

// ── Public API ───────────────────────────────────────────────

/** Register callbacks. Call once from the voice store on init. */
export function setVoiceCallbacks(callbacks: {
  onTranscriptUpdate: (text: string, isFinal: boolean) => void;
  onStateChange: (state: VoiceState) => void;
  onError: (error: string) => void;
  onAutoSend: (text: string) => void;
  onWakeWordDetected: () => void;
  onContinuousExit: () => void;
}) {
  onTranscriptUpdate = callbacks.onTranscriptUpdate;
  onStateChange = callbacks.onStateChange;
  onError = callbacks.onError;
  onAutoSend = callbacks.onAutoSend;
  onWakeWordDetected = callbacks.onWakeWordDetected;
  onContinuousExit = callbacks.onContinuousExit;
}

/** Update settings (called whenever settings change). */
export function applyVoiceSettings(settings: VoiceSettings) {
  currentSettings = settings;
  currentMode = settings.mode;

  // If recognition exists, update language
  if (recognition) {
    recognition.lang = settings.language;
  }

  // If mode changed to wake-word and enabled, start listening for wake word
  if (settings.enabled && settings.mode === "wake-word" && !isMuted) {
    if (!isRecognitionActive) {
      wakeWordDetected = false;
      startRecognitionSafe();
      onStateChange?.("wake-listening");
    }
  }

  // If mode changed away from wake-word/continuous, stop auto-listening
  if (settings.mode === "push-to-talk" && isRecognitionActive) {
    stopRecognitionSafe();
    onStateChange?.("idle");
  }
}

/** Push-to-talk: start recording (called on button press). */
export function startPushToTalk() {
  if (isMuted || !currentSettings.enabled) return;
  currentMode = "push-to-talk";
  interimTranscript = "";
  finalTranscript = "";
  recognition = createRecognition();
  startRecognitionSafe();
  playListeningStart();
  onStateChange?.("listening");
}

/** Push-to-talk: stop recording and return transcript (called on button release). */
export function stopPushToTalk(): string {
  playListeningStop();
  stopRecognitionSafe();
  onStateChange?.("idle");
  const result = (finalTranscript || interimTranscript).trim();
  finalTranscript = "";
  interimTranscript = "";
  return result;
}

/** Start continuous conversation mode. */
export function startContinuousMode() {
  if (isMuted || !currentSettings.enabled) return;
  currentMode = "continuous";
  interimTranscript = "";
  finalTranscript = "";
  wakeWordDetected = false;
  recognition = createRecognition();
  startRecognitionSafe();
  playListeningStart();
  onStateChange?.("listening");
}

/** Start wake-word listening mode. */
export function startWakeWordMode() {
  if (isMuted || !currentSettings.enabled) return;
  currentMode = "wake-word";
  interimTranscript = "";
  finalTranscript = "";
  wakeWordDetected = false;
  recognition = createRecognition();
  startRecognitionSafe();
  onStateChange?.("wake-listening");
}

/** Stop all voice activity. */
export function stopAll() {
  stopRecognitionSafe();
  wakeWordDetected = false;
  playListeningStop();
  onStateChange?.("idle");
}

/** Toggle mute. Returns new muted state. */
export function toggleMute(): boolean {
  isMuted = !isMuted;

  if (isMuted) {
    stopRecognitionSafe();
    onStateChange?.("muted");
  } else {
    onStateChange?.("idle");
    // Resume wake-word or continuous if that's the active mode
    if (currentSettings.mode === "wake-word") {
      startWakeWordMode();
    } else if (currentSettings.mode === "continuous") {
      startContinuousMode();
    }
  }

  return isMuted;
}

/** Set mute state directly. */
export function setMuted(muted: boolean) {
  if (isMuted === muted) return;
  toggleMute();
}

/** Check if muted. */
export function getMuted(): boolean {
  return isMuted;
}

/** Check if Web Speech API is available. */
export function isSpeechAvailable(): boolean {
  return !!SpeechRecognition;
}

// ── Global mute hotkey (Tauri) ───────────────────────────────

/** Register the F9 global mute hotkey via Tauri. */
export async function registerMuteHotkey(hotkey: string = "F9") {
  // Unregister previous if any
  await unregisterMuteHotkey();

  try {
    // Listen for the hotkey event from Rust
    unlistenMuteHotkey = await listen("voice-mute-toggle", () => {
      toggleMute();
    });

    // Tell Rust to register the global shortcut
    await invoke("register_voice_mute_hotkey", { hotkey });
  } catch (e: any) {
    console.warn("Failed to register voice mute hotkey:", e);
  }
}

/** Unregister the global mute hotkey. */
export async function unregisterMuteHotkey() {
  if (unlistenMuteHotkey) {
    unlistenMuteHotkey();
    unlistenMuteHotkey = null;
  }

  try {
    await invoke("unregister_voice_mute_hotkey");
  } catch { /* might not be registered */ }
}

// ── Sensitive app detection ──────────────────────────────────

/** Check if the currently active app is in the sensitive list. */
export async function checkSensitiveApp(): Promise<boolean> {
  if (!currentSettings.autoPauseSensitiveApps) return false;
  if (currentSettings.sensitiveApps.length === 0) return false;

  try {
    const activeWindow: { app_name: string; title: string } = await invoke("get_active_window");
    const appLower = activeWindow.app_name.toLowerCase();
    const titleLower = activeWindow.title.toLowerCase();

    return currentSettings.sensitiveApps.some((app) => {
      const lower = app.toLowerCase();
      return appLower.includes(lower) || titleLower.includes(lower);
    });
  } catch {
    return false;
  }
}