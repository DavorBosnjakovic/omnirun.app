// ============================================================
// voiceService.ts
// ============================================================
// Voice control service for Omnirun.
//
// Audio capture: Web Audio API (ScriptProcessorNode) in the webview.
// Wake word: Rust ONNX pipeline (local, no network).
// Speech-to-text: whisper.cpp in Rust (local, no network).
//
// The frontend captures mic audio, resamples to 16kHz, then sends
// chunks to Rust via Tauri commands.
// Rust handles wake word detection + whisper transcription.
// Zero audio leaves the device. Everything runs locally.
//
// Path: src/services/voiceService.ts

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ── Types ────────────────────────────────────────────────────

export type VoiceMode = "push-to-talk" | "wake-word" | "continuous";
export type VoiceState =
  | "idle"
  | "listening"
  | "processing"
  | "wake-listening"
  | "muted";
export type VoiceLanguage =
  | "en-US" | "en-GB" | "es-ES" | "fr-FR" | "de-DE" | "it-IT"
  | "pt-BR" | "ja-JP" | "ko-KR" | "zh-CN" | "nl-NL" | "ru-RU" | "sr-RS";

// Map frontend language codes to whisper ISO 639-1
const WHISPER_LANG_MAP: Record<VoiceLanguage, string> = {
  "en-US": "en", "en-GB": "en", "es-ES": "es", "fr-FR": "fr",
  "de-DE": "de", "it-IT": "it", "pt-BR": "pt", "ja-JP": "ja",
  "ko-KR": "ko", "zh-CN": "zh", "nl-NL": "nl", "ru-RU": "ru",
  "sr-RS": "sr",
};

export interface VoiceSettings {
  enabled: boolean;
  mode: VoiceMode;
  language: VoiceLanguage;
  muteHotkey: string;
  audioFeedback: boolean;
  autoSendOnSilence: boolean;
  silenceTimeout: number; // ms
  showMicIndicator: boolean;
  autoPauseSensitiveApps: boolean;
  sensitiveApps: string[];
  continuousExitPhrase: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  mode: "push-to-talk",
  language: "en-US",
  muteHotkey: "F9",
  audioFeedback: true,
  autoSendOnSilence: true,
  silenceTimeout: 1500,
  showMicIndicator: true,
  autoPauseSensitiveApps: true,
  sensitiveApps: [],
  continuousExitPhrase: "that's all",
};

interface AudioResult {
  event: "none" | "wake_word" | "transcript";
  score: number;
  transcript: string;
}

const STORAGE_KEY = "omnirun_voice_settings";
const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SIZE = 1280; // 80ms at 16kHz

// ── Settings persistence ─────────────────────────────────────

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    return { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ── Callbacks ────────────────────────────────────────────────

let onTranscriptUpdate: ((text: string, isFinal: boolean) => void) | null = null;
let onStateChange: ((state: VoiceState) => void) | null = null;
let onError: ((error: string) => void) | null = null;
let onAutoSend: ((text: string) => void) | null = null;
let onWakeWordDetected: (() => void) | null = null;
let onContinuousExit: (() => void) | null = null;

// ── Internal state ───────────────────────────────────────────

let currentSettings: VoiceSettings = DEFAULT_VOICE_SETTINGS;
let currentMode: VoiceMode = "push-to-talk";
let isMuted = false;
let engineReady = false;

// Audio pipeline
let audioCtx: AudioContext | null = null;
let micStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let isMicActive = false;
let isFeedingAudio = false;

// Resampling + chunking buffers
let chunkBuffer: number[] = [];
let debugLogCount = 0;

// Silence detection
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let silenceCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastAudioRms = 0;
const SILENCE_RMS_THRESHOLD = 0.01;

// Hotkey
let unlistenMuteHotkey: UnlistenFn | null = null;

// ── Audio feedback ───────────────────────────────────────────

const feedbackCtx = typeof AudioContext !== "undefined" ? new AudioContext() : null;

function playTone(frequency: number, duration: number, volume = 0.15) {
  if (!feedbackCtx || !currentSettings.audioFeedback) return;
  try {
    const osc = feedbackCtx.createOscillator();
    const gain = feedbackCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, feedbackCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(feedbackCtx.destination);
    osc.start();
    osc.stop(feedbackCtx.currentTime + duration);
  } catch { /* audio not available */ }
}

function playListeningStart() { playTone(880, 0.12); }
function playListeningStop() { playTone(440, 0.12); }
function playWakeWordChime() {
  playTone(660, 0.08);
  setTimeout(() => playTone(880, 0.1), 100);
}

// ── Audio capture with resampling ────────────────────────────
// Uses ScriptProcessorNode (runs on main thread in the webview).
// WebView2 typically runs AudioContext at 48kHz — we resample
// to 16kHz for whisper and wake word detection.

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLen = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLen);
  for (let i = 0; i < outputLen; i++) {
    const srcIdx = i * ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    if (idx + 1 < input.length) {
      output[i] = input[idx] * (1 - frac) + input[idx + 1] * frac;
    } else if (idx < input.length) {
      output[i] = input[idx];
    }
  }
  return output;
}

async function initMicPipeline(): Promise<void> {
  if (audioCtx) return; // Already initialized

  try {
    // Create AudioContext at default system rate (usually 48kHz).
    // We resample to 16kHz manually before sending to Rust.
    audioCtx = new AudioContext();

    // Request mic access
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    sourceNode = audioCtx.createMediaStreamSource(micStream);

    // ScriptProcessorNode: buffer 4096 samples, mono in, mono out
    // At 48kHz this fires every ~85ms
    scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
    chunkBuffer = [];
    debugLogCount = 0;

    scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!isFeedingAudio || isMuted) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const nativeRate = audioCtx!.sampleRate;

      // Debug: log raw mic audio for first 3 callbacks
      if (debugLogCount < 3) {
        let rawSum = 0;
        let rawMax = 0;
        for (let i = 0; i < inputData.length; i++) {
          rawSum += inputData[i] * inputData[i];
          const abs = Math.abs(inputData[i]);
          if (abs > rawMax) rawMax = abs;
        }
        const rawRms = Math.sqrt(rawSum / inputData.length);
        console.log(
          `[voiceService] RAW mic: len=${inputData.length} rate=${nativeRate} rms=${rawRms.toFixed(6)} max=${rawMax.toFixed(6)}`
        );
        debugLogCount++;
      }

      // Resample from native rate (48kHz) to 16kHz
      const resampled = resample(inputData, nativeRate, TARGET_SAMPLE_RATE);

      // Track RMS for silence detection
      let sum = 0;
      for (let i = 0; i < resampled.length; i++) {
        sum += resampled[i] * resampled[i];
      }
      lastAudioRms = Math.sqrt(sum / resampled.length);

      // Accumulate into chunk buffer and send complete 1280-sample chunks
      for (let i = 0; i < resampled.length; i++) {
        chunkBuffer.push(resampled[i]);
      }

      while (chunkBuffer.length >= CHUNK_SIZE) {
        const chunk = chunkBuffer.splice(0, CHUNK_SIZE);
        invoke<AudioResult>("feed_audio_samples", {
          samples: chunk,
        }).then(handleAudioResult).catch(() => {});
      }
    };

    // Connect: mic → processor → destination (must connect to keep it alive)
    sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(audioCtx.destination);

    isMicActive = true;

    // Suspend immediately — we'll resume when needed
    await audioCtx.suspend();

    console.log(
      "[voiceService] Mic pipeline initialized. Native rate:",
      audioCtx.sampleRate,
      "Hz → resampling to",
      TARGET_SAMPLE_RATE,
      "Hz"
    );
  } catch (err: any) {
    onError?.("Mic access failed: " + (err?.message || err));
    throw err;
  }
}

async function resumeMic() {
  if (audioCtx && audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  // Reset debug counter so we get fresh logs each time
  debugLogCount = 0;
  isFeedingAudio = true;
}

async function suspendMic() {
  isFeedingAudio = false;
  if (audioCtx && audioCtx.state === "running") {
    await audioCtx.suspend();
  }
}

function destroyMicPipeline() {
  isFeedingAudio = false;
  isMicActive = false;

  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  chunkBuffer = [];
}

// ── Handle results from Rust engine ──────────────────────────

function handleAudioResult(result: AudioResult) {
  if (result.event === "wake_word") {
    playWakeWordChime();
    onWakeWordDetected?.();

    // Switch to capture mode
    invoke("start_capture").catch(() => {});
    onStateChange?.("listening");
    onTranscriptUpdate?.("", false);

    // Give user 2 seconds to start speaking before silence detection kicks in
    setTimeout(() => startSilenceDetection(), 2000);
  }
}

// ── Silence detection (for auto-send after wake word / continuous) ──

function startSilenceDetection() {
  resetSilenceTimer();

  silenceCheckInterval = setInterval(() => {
    if (!isFeedingAudio || isMuted) return;

    if (lastAudioRms < SILENCE_RMS_THRESHOLD) {
      if (!silenceTimer) {
        silenceTimer = setTimeout(async () => {
          silenceTimer = null;
          if (silenceCheckInterval) {
            clearInterval(silenceCheckInterval);
            silenceCheckInterval = null;
          }

          onStateChange?.("processing");
          onTranscriptUpdate?.("Transcribing...", false);

          try {
            const result = await invoke<AudioResult>("finish_capture");
            const text = result.transcript.trim();

            if (text) {
              if (
                currentMode === "continuous" &&
                text.toLowerCase().includes(currentSettings.continuousExitPhrase.toLowerCase())
              ) {
                stopAll();
                onContinuousExit?.();
                return;
              }

              onTranscriptUpdate?.(text, true);
              onAutoSend?.(text);
            }
          } catch (err: any) {
            onError?.("Transcription failed: " + (err?.message || err));
          }

          if (currentMode === "wake-word") {
            invoke("set_wake_listening", { active: true }).catch(() => {});
            onStateChange?.("wake-listening");
          } else if (currentMode === "continuous") {
            invoke("start_capture").catch(() => {});
            onStateChange?.("listening");
            startSilenceDetection();
          } else {
            onStateChange?.("idle");
          }
        }, currentSettings.silenceTimeout);
      }
    } else {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    }
  }, 100);
}

function resetSilenceTimer() {
  if (silenceCheckInterval) {
    clearInterval(silenceCheckInterval);
    silenceCheckInterval = null;
  }
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

// ── Initialize Rust engine ───────────────────────────────────

async function initEngine(): Promise<void> {
  if (engineReady) return;
  try {
    await invoke("init_voice_engine");
    engineReady = true;
    console.log("[voiceService] Rust voice engine ready");
  } catch (err: any) {
    console.warn("[voiceService] Engine init failed:", err);
    onError?.("Voice engine failed to load: " + (err?.message || err));
  }
}

// ── Public API ───────────────────────────────────────────────

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

export async function applyVoiceSettings(settings: VoiceSettings) {
  const previousMode = currentSettings.mode;
  currentSettings = settings;
  currentMode = settings.mode;

  const whisperLang = WHISPER_LANG_MAP[settings.language] || "en";
  invoke("set_voice_language", { lang: whisperLang }).catch(() => {});

  if (!settings.enabled) {
    stopAll();
    return;
  }

  await initEngine();
  await initMicPipeline();

  if (settings.mode === "wake-word" && !isMuted) {
    resetSilenceTimer();
    await resumeMic();
    isFeedingAudio = true;
    await invoke("set_wake_listening", { active: true });
    onStateChange?.("wake-listening");
  }

  if (settings.mode === "continuous" && !isMuted) {
    resetSilenceTimer();
    await resumeMic();
    isFeedingAudio = true;
    await invoke("start_capture");
    onStateChange?.("listening");
    startSilenceDetection();
  }

  if (settings.mode === "push-to-talk") {
    resetSilenceTimer();
    await invoke("set_wake_listening", { active: false }).catch(() => {});
    await invoke("cancel_capture").catch(() => {});
    await suspendMic();
    onStateChange?.("idle");
  }

  if (previousMode === "wake-word" && settings.mode !== "wake-word") {
    await invoke("set_wake_listening", { active: false }).catch(() => {});
  }
}

export async function startPushToTalk() {
  if (isMuted || !currentSettings.enabled) return;

  await initEngine();
  await initMicPipeline();

  playListeningStart();
  await resumeMic();
  isFeedingAudio = true;
  await invoke("start_capture");
  onTranscriptUpdate?.("", false);
  onStateChange?.("listening");
}

export async function stopPushToTalk(): Promise<string> {
  playListeningStop();
  isFeedingAudio = false;
  onStateChange?.("processing");
  onTranscriptUpdate?.("Transcribing...", false);

  try {
    const result = await invoke<AudioResult>("finish_capture");
    const text = result.transcript.trim();

    await suspendMic();
    onStateChange?.("idle");
    onTranscriptUpdate?.(text, true);
    return text;
  } catch (err: any) {
    await suspendMic();
    onStateChange?.("idle");
    onError?.("Transcription failed: " + (err?.message || err));
    return "";
  }
}

export async function startContinuousMode() {
  if (isMuted || !currentSettings.enabled) return;

  await initEngine();
  await initMicPipeline();

  currentMode = "continuous";
  playListeningStart();
  await resumeMic();
  isFeedingAudio = true;
  await invoke("start_capture");
  onStateChange?.("listening");
  startSilenceDetection();
}

export async function startWakeWordMode() {
  if (isMuted || !currentSettings.enabled) return;

  await initEngine();
  await initMicPipeline();

  currentMode = "wake-word";
  await resumeMic();
  isFeedingAudio = true;
  await invoke("set_wake_listening", { active: true });
  onStateChange?.("wake-listening");
}

export async function stopAll() {
  resetSilenceTimer();
  isFeedingAudio = false;

  await invoke("cancel_capture").catch(() => {});
  await invoke("set_wake_listening", { active: false }).catch(() => {});
  await suspendMic();

  playListeningStop();
  onStateChange?.("idle");
}

export function toggleMute(): boolean {
  isMuted = !isMuted;

  if (isMuted) {
    resetSilenceTimer();
    isFeedingAudio = false;
    invoke("set_voice_muted", { muted: true }).catch(() => {});
    suspendMic();
    onStateChange?.("muted");
  } else {
    invoke("set_voice_muted", { muted: false }).catch(() => {});

    if (currentSettings.mode === "wake-word") {
      startWakeWordMode();
    } else if (currentSettings.mode === "continuous") {
      startContinuousMode();
    } else {
      onStateChange?.("idle");
    }
  }

  return isMuted;
}

export function setMuted(muted: boolean) {
  if (isMuted === muted) return;
  toggleMute();
}

export function getMuted(): boolean {
  return isMuted;
}

export function isSpeechAvailable(): boolean {
  return typeof AudioContext !== "undefined" || typeof (window as any).webkitAudioContext !== "undefined";
}

export function isEngineReady(): boolean {
  return engineReady;
}

// ── Global mute hotkey (Tauri) ───────────────────────────────

export async function registerMuteHotkey(hotkey: string = "F9") {
  await unregisterMuteHotkey();

  try {
    unlistenMuteHotkey = await listen("voice-mute-toggle", () => {
      toggleMute();
    });

    await invoke("register_voice_mute_hotkey", { hotkey });
  } catch (e: any) {
    console.warn("Failed to register voice mute hotkey:", e);
  }
}

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

// ── Cleanup ──────────────────────────────────────────────────

export function destroy() {
  resetSilenceTimer();
  destroyMicPipeline();
  invoke("shutdown_voice_engine").catch(() => {});
  engineReady = false;
}