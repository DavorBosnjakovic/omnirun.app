// ============================================================
// voice_engine.rs
// ============================================================
// Unified local voice engine for Omnirun.
//
// Audio capture happens in the frontend (Web Audio API).
// Frontend sends 16kHz f32 samples to Rust via Tauri commands.
// Rust handles:
//   1. Wake word detection (openWakeWord ONNX pipeline)
//   2. Speech-to-text (whisper.cpp via whisper-rs)
//
// Zero audio leaves the device. Everything runs locally.
//
// Path: src-tauri/src/voice_engine.rs

use std::sync::Mutex;
use std::collections::VecDeque;
use serde::Serialize;
use tauri::Manager;
use ort::session::Session;
use ort::value::Tensor;

// ── Constants ────────────────────────────────────────────────

const CHUNK_SAMPLES: usize = 1280; // 80ms at 16kHz
const MEL_WINDOW_SIZE: usize = 76;
const MEL_SLIDE_STEP: usize = 8;
const EMBEDDING_BUFFER_SIZE: usize = 16;
const EMBEDDING_DIM: usize = 96;
const DETECTION_THRESHOLD: f32 = 0.02;

// ── Types ────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
pub struct AudioResult {
    pub event: String,      // "none" | "wake_word" | "transcript"
    pub score: f32,         // wake word confidence (0.0 if N/A)
    pub transcript: String, // whisper output (empty if N/A)
}

impl AudioResult {
    fn none() -> Self {
        Self { event: "none".into(), score: 0.0, transcript: String::new() }
    }
    fn wake_word(score: f32) -> Self {
        Self { event: "wake_word".into(), score, transcript: String::new() }
    }
    fn transcript(text: String) -> Self {
        Self { event: "transcript".into(), score: 0.0, transcript: text }
    }
}

// ── Engine State ─────────────────────────────────────────────

struct EngineInner {
    // Wake word ONNX sessions
    mel_session: Session,
    embed_session: Session,
    ww_session: Session,
    mel_input_name: String,
    embed_input_name: String,
    ww_input_name: String,

    // Wake word processing buffers
    mel_buffer: Vec<Vec<f32>>,
    embedding_buffer: VecDeque<Vec<f32>>,
    ww_audio_buffer: Vec<f32>,

    // Whisper context
    whisper_ctx: whisper_rs::WhisperContext,
    language: String, // "en", "es", "fr", etc.

    // Capture buffer (audio buffered for whisper transcription)
    capture_buffer: Vec<f32>,

    // State flags
    capturing: bool,       // true = buffering audio for whisper
    wake_listening: bool,  // true = running wake word detection
    muted: bool,
}

static ENGINE: Mutex<Option<EngineInner>> = Mutex::new(None);

// ── Tauri Commands ───────────────────────────────────────────

/// Initialize the voice engine. Loads all ONNX models + whisper model.
/// Call once on app startup (or when voice is first enabled).
///
/// Models expected at:
///   resources/wake_word/melspectrogram.onnx
///   resources/wake_word/embedding_model.onnx
///   resources/wake_word/hey_omni.onnx
///   resources/whisper/ggml-base.en.bin
#[tauri::command]
pub fn init_voice_engine(app: tauri::AppHandle) -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // Already initialized
    }

    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("resource dir: {}", e))?
        .join("resources");

    let ww_dir = resource_dir.join("wake_word");
    let mel_path = ww_dir.join("melspectrogram.onnx");
    let embed_path = ww_dir.join("embedding_model.onnx");
    let ww_path = ww_dir.join("hey_omni.onnx");
    let whisper_path = resource_dir.join("whisper").join("ggml-base.en.bin");

    // Validate all model files exist
    for (name, path) in [
        ("melspectrogram.onnx", &mel_path),
        ("embedding_model.onnx", &embed_path),
        ("hey_omni.onnx", &ww_path),
        ("ggml-base.en.bin", &whisper_path),
    ] {
        if !path.exists() {
            return Err(format!("Model not found: {} (expected at {:?})", name, path));
        }
    }

    eprintln!("[voice_engine] Loading ONNX models...");

    let mel_session = Session::builder().map_err(|e| e.to_string())?
        .with_intra_threads(1).map_err(|e| e.to_string())?
        .commit_from_file(&mel_path).map_err(|e| format!("mel model: {}", e))?;
    let embed_session = Session::builder().map_err(|e| e.to_string())?
        .with_intra_threads(1).map_err(|e| e.to_string())?
        .commit_from_file(&embed_path).map_err(|e| format!("embed model: {}", e))?;
    let ww_session = Session::builder().map_err(|e| e.to_string())?
        .with_intra_threads(1).map_err(|e| e.to_string())?
        .commit_from_file(&ww_path).map_err(|e| format!("ww model: {}", e))?;

    // Log model I/O info
    eprintln!("[voice_engine] mel: in={:?} out={:?}",
        mel_session.inputs().iter().map(|i| i.name().to_string()).collect::<Vec<_>>(),
        mel_session.outputs().iter().map(|o| o.name().to_string()).collect::<Vec<_>>());
    eprintln!("[voice_engine] embed: in={:?} out={:?}",
        embed_session.inputs().iter().map(|i| i.name().to_string()).collect::<Vec<_>>(),
        embed_session.outputs().iter().map(|o| o.name().to_string()).collect::<Vec<_>>());
    eprintln!("[voice_engine] ww: in={:?} out={:?}",
        ww_session.inputs().iter().map(|i| i.name().to_string()).collect::<Vec<_>>(),
        ww_session.outputs().iter().map(|o| o.name().to_string()).collect::<Vec<_>>());

    let mel_input_name = mel_session.inputs()[0].name().to_string();
    let embed_input_name = embed_session.inputs()[0].name().to_string();
    let ww_input_name = ww_session.inputs()[0].name().to_string();

    eprintln!("[voice_engine] Loading whisper model...");

    let whisper_ctx = whisper_rs::WhisperContext::new_with_params(
        whisper_path.to_str().ok_or("Invalid whisper path")?,
        whisper_rs::WhisperContextParameters::default(),
    ).map_err(|e| format!("whisper model: {}", e))?;

    eprintln!("[voice_engine] All models loaded successfully");

    *guard = Some(EngineInner {
        mel_session, embed_session, ww_session,
        mel_input_name, embed_input_name, ww_input_name,
        mel_buffer: Vec::new(),
        embedding_buffer: VecDeque::with_capacity(EMBEDDING_BUFFER_SIZE),
        ww_audio_buffer: Vec::new(),
        whisper_ctx,
        language: "en".into(),
        capture_buffer: Vec::new(),
        capturing: false,
        wake_listening: false,
        muted: false,
    });

    Ok(())
}

/// Shutdown the voice engine and free all models.
#[tauri::command]
pub fn shutdown_voice_engine() -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    *guard = None;
    eprintln!("[voice_engine] Shutdown");
    Ok(())
}

/// Feed 16kHz f32 audio samples from the frontend.
/// Returns an event if something happened (wake word detected, etc).
///
/// The frontend calls this every ~80ms with 1280 samples.
/// When capturing, samples are buffered for whisper.
/// When wake-listening, samples go through the ONNX wake word pipeline.
#[tauri::command]
pub fn feed_audio_samples(samples: Vec<f32>) -> Result<AudioResult, String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_mut().ok_or("Voice engine not initialized")?;

    if engine.muted {
        return Ok(AudioResult::none());
    }

    // ── Capture mode: buffer audio for whisper ──
    if engine.capturing {
        engine.capture_buffer.extend_from_slice(&samples);
        return Ok(AudioResult::none());
    }

    // ── Wake word detection mode ──
    if engine.wake_listening {
        engine.ww_audio_buffer.extend_from_slice(&samples);

        while engine.ww_audio_buffer.len() >= CHUNK_SAMPLES {
            let chunk: Vec<f32> = engine.ww_audio_buffer.drain(..CHUNK_SAMPLES).collect();

            if let Some(score) = process_chunk(engine, &chunk) {
                // Log every score above 0.01, and every 50th score regardless
                static CALL_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                let c = CALL_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if score > 0.01 || c % 50 == 0 {
                    eprintln!("[voice_engine] ww score={:.4} (chunk {})", score, c);
                }

                if score > DETECTION_THRESHOLD {
                    eprintln!("[voice_engine] *** WAKE WORD DETECTED score={:.4} ***", score);
                    engine.mel_buffer.clear();
                    engine.embedding_buffer.clear();
                    return Ok(AudioResult::wake_word(score));
                }
            }
        }
    }

    Ok(AudioResult::none())
}

/// Start capturing audio for whisper transcription.
/// Called when push-to-talk button is pressed or after wake word detection.
#[tauri::command]
pub fn start_capture() -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_mut().ok_or("Voice engine not initialized")?;

    engine.capture_buffer.clear();
    engine.capturing = true;
    // Pause wake word detection while capturing
    // (it will be re-enabled by set_wake_listening after transcript is processed)
    engine.wake_listening = false;
    eprintln!("[voice_engine] Capture started");
    Ok(())
}

/// Stop capturing and run whisper transcription on the buffered audio.
/// Returns the transcript text. This blocks for ~0.5-2s depending on audio length.
#[tauri::command]
pub fn finish_capture() -> Result<AudioResult, String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_mut().ok_or("Voice engine not initialized")?;

    engine.capturing = false;

    if engine.capture_buffer.is_empty() {
        eprintln!("[voice_engine] Capture finished (empty buffer)");
        return Ok(AudioResult::transcript(String::new()));
    }

    let audio = std::mem::take(&mut engine.capture_buffer);
    let rms: f32 = (audio.iter().map(|s| s * s).sum::<f32>() / audio.len() as f32).sqrt();
    let max_val: f32 = audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    eprintln!("[voice_engine] Audio stats: len={} rms={:.6} max={:.6}", audio.len(), rms, max_val);
    let duration_secs = audio.len() as f32 / 16000.0;
    eprintln!("[voice_engine] Running whisper on {:.1}s of audio...", duration_secs);

    let transcript = run_whisper(engine, &audio)?;
    eprintln!("[voice_engine] Transcript: {:?}", transcript);

    Ok(AudioResult::transcript(transcript))
}

/// Cancel an in-progress capture without transcribing.
#[tauri::command]
pub fn cancel_capture() -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_mut().ok_or("Voice engine not initialized")?;

    engine.capturing = false;
    engine.capture_buffer.clear();
    eprintln!("[voice_engine] Capture cancelled");
    Ok(())
}

/// Enable/disable wake word detection.
#[tauri::command]
pub fn set_wake_listening(active: bool) -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_mut().ok_or("Voice engine not initialized")?;

    engine.wake_listening = active;
    if active {
        // Clear stale wake word buffers
        engine.mel_buffer.clear();
        engine.embedding_buffer.clear();
        engine.ww_audio_buffer.clear();
    }
    eprintln!("[voice_engine] Wake listening = {}", active);
    Ok(())
}

/// Mute/unmute the engine. When muted, all audio is ignored.
#[tauri::command]
pub fn set_voice_muted(muted: bool) -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_mut().ok_or("Voice engine not initialized")?;

    engine.muted = muted;
    if muted {
        engine.capturing = false;
        engine.capture_buffer.clear();
    }
    eprintln!("[voice_engine] Muted = {}", muted);
    Ok(())
}

/// Set the language for whisper transcription.
/// Use ISO 639-1 codes: "en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "nl", "ru", "sr"
#[tauri::command]
pub fn set_voice_language(lang: String) -> Result<(), String> {
    let mut guard = ENGINE.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_mut().ok_or("Voice engine not initialized")?;

    engine.language = lang.clone();
    eprintln!("[voice_engine] Language = {}", lang);
    Ok(())
}

/// Check if the engine is initialized and ready.
#[tauri::command]
pub fn is_voice_engine_ready() -> bool {
    ENGINE.lock().map(|g| g.is_some()).unwrap_or(false)
}

// ── Whisper Transcription ────────────────────────────────────

fn run_whisper(engine: &EngineInner, audio: &[f32]) -> Result<String, String> {
    let mut state = engine.whisper_ctx.create_state()
        .map_err(|e| format!("Whisper state: {}", e))?;

    let mut params = whisper_rs::FullParams::new(
        whisper_rs::SamplingStrategy::Greedy { best_of: 1 }
    );
    params.set_language(Some(&engine.language));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_single_segment(false);
    params.set_no_context(true);
    // Suppress non-speech tokens for cleaner output
    params.set_suppress_blank(true);

    state.full(params, audio)
        .map_err(|e| format!("Whisper inference: {}", e))?;

    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&format!("{}", segment));
    }

    // Strip whisper special tokens: [BLANK_AUDIO], [Music], [Applause], etc.
    let cleaned = regex::Regex::new(r"\[.*?\]")
        .map(|re| re.replace_all(text.trim(), "").trim().to_string())
        .unwrap_or_else(|_| text.trim().to_string());

    Ok(cleaned)
}

// ── Wake Word ONNX Pipeline ─────────────────────────────────
// (Preserved from wake_word.rs — the ONNX pipeline was working)

fn process_chunk(engine: &mut EngineInner, chunk: &[f32]) -> Option<f32> {
    let mel_frames = run_melspectrogram(engine, chunk)?;
    engine.mel_buffer.extend(mel_frames);

    while engine.mel_buffer.len() >= MEL_WINDOW_SIZE {
        let window: Vec<Vec<f32>> = engine.mel_buffer[..MEL_WINDOW_SIZE].to_vec();
        if let Some(embedding) = run_embedding(engine, &window) {
            engine.embedding_buffer.push_back(embedding);
            if engine.embedding_buffer.len() > EMBEDDING_BUFFER_SIZE {
                engine.embedding_buffer.pop_front();
            }
        }
        engine.mel_buffer.drain(..MEL_SLIDE_STEP);
    }

    if engine.embedding_buffer.len() >= EMBEDDING_BUFFER_SIZE {
        return run_wake_word_model(engine);
    }
    None
}

fn run_melspectrogram(engine: &mut EngineInner, chunk: &[f32]) -> Option<Vec<Vec<f32>>> {
    let tensor = Tensor::from_array(([1_usize, CHUNK_SAMPLES], chunk.to_vec())).ok()?;
    let outputs = engine.mel_session
        .run(ort::inputs![engine.mel_input_name.as_str() => tensor]).ok()?;

    let output = &outputs[0];
    let (shape, data) = output.try_extract_tensor::<f32>().ok()?;

    let (num_frames, num_mels) = if shape.len() == 4 {
        (shape[shape.len() - 2] as usize, shape[shape.len() - 1] as usize)
    } else if shape.len() == 3 {
        (shape[1] as usize, shape[2] as usize)
    } else if shape.len() == 2 {
        (shape[0] as usize, shape[1] as usize)
    } else {
        return None;
    };

    let mut frames = Vec::with_capacity(num_frames);
    for f in 0..num_frames {
        let mut frame = Vec::with_capacity(num_mels);
        for m in 0..num_mels {
            let idx = f * num_mels + m;
            if idx < data.len() {
                frame.push((data[idx] / 10.0) + 2.0);
            }
        }
        frames.push(frame);
    }
    Some(frames)
}

fn run_embedding(engine: &mut EngineInner, window: &[Vec<f32>]) -> Option<Vec<f32>> {
    let num_mels = window.first()?.len();
    let mut flat = Vec::with_capacity(MEL_WINDOW_SIZE * num_mels);
    for frame in window.iter().take(MEL_WINDOW_SIZE) {
        flat.extend_from_slice(frame);
    }

    // Embedding model expects [1, 76, num_mels, 1]
    let tensor = Tensor::from_array(([1_usize, MEL_WINDOW_SIZE, num_mels, 1_usize], flat)).ok()?;
    let outputs = engine.embed_session
        .run(ort::inputs![engine.embed_input_name.as_str() => tensor]).ok()?;

    let output = &outputs[0];
    let (_shape, data) = output.try_extract_tensor::<f32>().ok()?;
    Some(data.to_vec())
}

fn run_wake_word_model(engine: &mut EngineInner) -> Option<f32> {
    let mut flat = Vec::with_capacity(EMBEDDING_BUFFER_SIZE * EMBEDDING_DIM);
    for emb in engine.embedding_buffer.iter() {
        if emb.len() >= EMBEDDING_DIM {
            flat.extend_from_slice(&emb[..EMBEDDING_DIM]);
        } else {
            flat.extend_from_slice(emb);
            flat.extend(std::iter::repeat(0.0f32).take(EMBEDDING_DIM - emb.len()));
        }
    }

    let tensor = Tensor::from_array(
        ([1_usize, EMBEDDING_BUFFER_SIZE, EMBEDDING_DIM], flat)
    ).ok()?;
    let outputs = engine.ww_session
        .run(ort::inputs![engine.ww_input_name.as_str() => tensor]).ok()?;

    let output = &outputs[0];
    let (_shape, data) = output.try_extract_tensor::<f32>().ok()?;
    data.iter().cloned().reduce(f32::max)
}