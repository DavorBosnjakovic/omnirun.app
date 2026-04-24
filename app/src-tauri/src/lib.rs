use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod server;
mod scheduler;
mod task_runner;
mod oauth;
mod screen_control;
mod voice_engine;
mod deploy;

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileEntry>>,
}

#[derive(Serialize, Deserialize)]
pub struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

/// Strip ANSI escape codes from a string.
/// Dev servers like Vite colorize port output (e.g. localhost:\x1b[1m5174\x1b[0m)
/// which breaks regex matching. This cleans the line before pattern matching.
fn strip_ansi_codes(s: &str) -> String {
    let re = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    re.replace_all(s, "").to_string()
}

// Store the allowed project path
static mut PROJECT_PATH: Option<PathBuf> = None;

// Store the dev server child process PID so we can kill it later
static DEV_SERVER_PROCESS: Mutex<Option<u32>> = Mutex::new(None);

// Buffer for dev server output (captured after port is found)
// Frontend can poll this to check for build errors
static DEV_SERVER_OUTPUT: once_cell::sync::Lazy<Arc<Mutex<String>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(String::new())));

// Store the currently registered voice mute hotkey
static VOICE_HOTKEY: Mutex<Option<String>> = Mutex::new(None);

// Store the currently registered screen control kill switch hotkey
static SCREEN_KILL_SWITCH: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn set_project_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    // Create directory if it doesn't exist (needed for template scaffolding)
    if !path_buf.exists() {
        std::fs::create_dir_all(&path_buf)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    if !path_buf.is_dir() {
        return Err("Path exists but is not a directory".to_string());
    }
    // Canonicalize to resolve any symlinks and get absolute path,
    // then strip the Windows \\?\ UNC prefix so stored path stays plain (D:\...)
    let canonical = path_buf.canonicalize().map_err(|e| e.to_string())?;
    let canonical = strip_unc_prefix(canonical);
    unsafe {
        PROJECT_PATH = Some(canonical);
    }
    Ok(())
}

#[tauri::command]
fn get_project_path() -> Option<String> {
    unsafe {
        PROJECT_PATH.as_ref().map(|p| p.to_string_lossy().to_string())
    }
}

/// On Windows, std::fs::canonicalize() returns extended-length UNC paths
/// like \\?\D:\Inkformer. This prefix breaks every downstream path comparison
/// because TypeScript splits on backslashes and loses the leading \\.
/// Stripping \\?\ is safe — it is only needed for paths longer than MAX_PATH.
fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = path.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped.to_string());
        }
    }
    path
}

fn is_path_allowed(requested: &PathBuf) -> bool {
    unsafe {
        if let Some(ref allowed) = PROJECT_PATH {
            // If path exists, canonicalize, strip UNC prefix, and check
            if let Ok(canonical) = requested.canonicalize() {
                return strip_unc_prefix(canonical).starts_with(allowed);
            }
            // For new files/dirs that don't exist yet, walk up until we find
            // an existing ancestor and verify it's within the project scope
            let mut ancestor = requested.parent();
            while let Some(parent) = ancestor {
                if let Ok(canonical_parent) = parent.canonicalize() {
                    return strip_unc_prefix(canonical_parent).starts_with(allowed);
                }
                ancestor = parent.parent();
            }
        }
    }
    false
}

#[tauri::command]
fn read_directory(path: String, depth: u32) -> Result<Vec<FileEntry>, String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }

    read_dir_recursive(&path_buf, depth)
}

fn read_dir_recursive(path: &PathBuf, depth: u32) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    
    let dir = fs::read_dir(path).map_err(|e| e.to_string())?;
    
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        
        // Skip hidden files and node_modules
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        
        let is_dir = entry_path.is_dir();
        let children = if is_dir && depth > 0 {
            read_dir_recursive(&entry_path, depth - 1).ok()
        } else {
            None
        };
        
        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }
    
    // Sort: directories first, then files, alphabetically
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    
    Ok(entries)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    fs::read_to_string(&path_buf).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    let metadata = fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    // Create parent directories if they don't exist
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    fs::write(&path_buf, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    fs::create_dir_all(&path_buf).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    if path_buf.is_dir() {
        fs::remove_dir_all(&path_buf).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path_buf).map_err(|e| e.to_string())
    }
}

// ── Terminal Commands ──────────────────────────────────────────

#[tauri::command]
async fn execute_command(command: String, cwd: String) -> Result<CommandResult, String> {
    let cwd_path = PathBuf::from(&cwd);

    // Verify cwd exists
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err(format!("Directory not found: {}", cwd));
    }

    let trimmed = command.trim().to_string();

    // Build the shell command based on OS
    // Uses tokio::process::Command so this runs asynchronously —
    // the UI stays responsive during long commands like npm install.
    let output = if cfg!(target_os = "windows") {
        let mut cmd = tokio::process::Command::new("C:\\Windows\\System32\\cmd.exe");
        cmd.arg("/D").arg("/S").arg("/C").arg(&trimmed);
        cmd.current_dir(&cwd_path);

        // Ensure PATH includes essential system directories and Node.js
        // Dedup + filter build artifacts + rustup to stay under Windows ~2047 char limit
        if let Ok(path) = std::env::var("PATH") {
            let mut seen = std::collections::HashSet::new();
            let clean: Vec<&str> = path.split(';')
                .filter(|p| !p.is_empty())
                .filter(|p| !p.contains("\\target\\debug") && !p.contains("\\target\\release"))
                .filter(|p| !p.contains("\\.rustup\\"))
                .filter(|p| seen.insert(p.to_lowercase()))
                .collect();
            cmd.env("PATH", clean.join(";"));
        }

        cmd.output().await
    } else {
        tokio::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(&trimmed)
            .current_dir(&cwd_path)
            .output()
            .await
    };

    match output {
        Ok(out) => Ok(CommandResult {
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            exit_code: out.status.code().unwrap_or(-1),
        }),
        Err(e) => Err(format!("Failed to execute command: {}", e)),
    }
}

#[tauri::command]
fn resolve_path(cwd: String, target: String) -> Result<String, String> {
    let target_path = if PathBuf::from(&target).is_absolute() {
        PathBuf::from(&target)
    } else {
        PathBuf::from(&cwd).join(&target)
    };

    // Canonicalize to resolve ".." and "." and verify it exists
    let resolved = target_path
        .canonicalize()
        .map_err(|_| format!("cd: no such directory: {}", target))?;

    if !resolved.is_dir() {
        return Err(format!("cd: not a directory: {}", target));
    }

    Ok(resolved.to_string_lossy().to_string())
}

// ── Preview Server Commands ─────────────────────────────────────

#[tauri::command]
async fn start_preview_server(path: String) -> Result<u16, String> {
    server::start(&path, 3456).await
}

#[tauri::command]
fn stop_preview_server() -> Result<(), String> {
    server::stop();
    Ok(())
}

#[tauri::command]
fn get_preview_port() -> Option<u16> {
    server::get_port()
}

#[tauri::command]
fn set_selection_mode(enabled: bool) {
    server::set_selection_mode(enabled);
}

#[tauri::command]
fn set_preview_proxy(target_port: Option<u16>) {
    server::set_proxy_target(target_port);
}

// ── Dev Server Commands (for framework projects) ────────────────

/// Helper to build a hidden shell command.
/// On Windows, sets CREATE_NO_WINDOW so no console flashes.
fn build_hidden_shell_command(command: &str, cwd: &PathBuf) -> std::process::Command {
    let mut cmd;

    if cfg!(target_os = "windows") {
        cmd = std::process::Command::new("C:\\Windows\\System32\\cmd.exe");
        cmd.arg("/D").arg("/S").arg("/C").arg(command);

        // Cargo build scripts (whisper-rs-sys, etc.) pollute PATH with hundreds
        // of build artifact directories, which can exceed the Windows ~2047 char
        // cmd.exe PATH limit. Filter those out so tools like npm are reachable.
        // Dedup + filter build artifacts + rustup to stay under Windows ~2047 char limit
        if let Ok(path) = std::env::var("PATH") {
            let mut seen = std::collections::HashSet::new();
            let clean: Vec<&str> = path.split(';')
                .filter(|p| !p.is_empty())
                .filter(|p| !p.contains("\\target\\debug") && !p.contains("\\target\\release"))
                .filter(|p| !p.contains("\\.rustup\\"))
                .filter(|p| seen.insert(p.to_lowercase()))
                .collect();
            cmd.env("PATH", clean.join(";"));
        }
    } else {
        cmd = std::process::Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
    }

    cmd.current_dir(cwd);

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    cmd
}

/// Start a long-running dev server process (e.g. `npm run dev`).
/// Captures stdout/stderr, watches for a localhost port in the output,
/// and returns the port once detected (or errors after timeout).
/// After port is found, keeps capturing output into DEV_SERVER_OUTPUT buffer
/// so the frontend can poll for build errors.
#[tauri::command]
async fn start_dev_server(command: String, cwd: String, port_pattern: String) -> Result<u16, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    // Kill any existing dev server first
    stop_dev_server_internal();

    // Clear the output buffer
    {
        let mut buf = DEV_SERVER_OUTPUT.lock().unwrap_or_else(|e| e.into_inner());
        buf.clear();
    }

    let cwd_path = PathBuf::from(&cwd);
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err(format!("Directory not found: {}", cwd));
    }

    // Spawn the dev server process with piped stdout and stderr
    let mut child = {
        let mut cmd = build_hidden_shell_command(&command, &cwd_path);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn()
    }
    .map_err(|e| format!("Failed to start dev server: {}", e))?;

    // Store the PID so we can kill it later
    let pid = child.id();
    {
        let mut proc = DEV_SERVER_PROCESS.lock().map_err(|e| e.to_string())?;
        *proc = Some(pid);
    }

    // Compile the port pattern regex
    let re = regex::Regex::new(&port_pattern)
        .map_err(|e| format!("Invalid port pattern: {}", e))?;

    // Take stdout and stderr handles
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Read both stdout and stderr in separate threads,
    // looking for the port pattern in either stream.
    // Dev servers vary — some print to stdout, some to stderr.
    let (tx, rx) = std::sync::mpsc::channel::<Result<u16, String>>();

    // Shared flag so both threads know when port has been found
    let port_found = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Spawn stdout reader
    if let Some(out) = stdout {
        let re_clone = re.clone();
        let tx_clone = tx.clone();
        let port_found_clone = port_found.clone();
        let output_buf = DEV_SERVER_OUTPUT.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(out);
            let mut captured = String::new();
            for line in reader.lines() {
                if let Ok(line) = line {
                    // Before port is found, check for port pattern
                    if !port_found_clone.load(std::sync::atomic::Ordering::Relaxed) {
                        if captured.len() < 2000 {
                            captured.push_str(&line);
                            captured.push('\n');
                        }
                        let clean = strip_ansi_codes(&line);
                        if let Some(caps) = re_clone.captures(&clean) {
                            if let Some(port_str) = caps.get(1) {
                                if let Ok(port) = port_str.as_str().parse::<u16>() {
                                    port_found_clone.store(true, std::sync::atomic::Ordering::Relaxed);
                                    let _ = tx_clone.send(Ok(port));
                                }
                            }
                        }
                    }

                    // Always capture output after port is found (for error detection)
                    if port_found_clone.load(std::sync::atomic::Ordering::Relaxed) {
                        if let Ok(mut buf) = output_buf.lock() {
                            // Keep buffer under 10KB — drop oldest lines
                            if buf.len() > 10_000 {
                                let cutoff = buf.len() - 5_000;
                                if let Some(pos) = buf[cutoff..].find('\n') {
                                    let new_start = cutoff + pos + 1;
                                    *buf = buf[new_start..].to_string();
                                }
                            }
                            buf.push_str(&line);
                            buf.push('\n');
                        }
                    }
                }
            }
            // Stream closed — if port was never found, report with captured output
            if !port_found_clone.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = tx_clone.send(Err(format!(
                    "Dev server stdout closed without printing a port. Output:\n{}",
                    if captured.is_empty() { "(no output on stdout)".to_string() } else { captured }
                )));
            }
        });
    }

    // Spawn stderr reader
    if let Some(err_stream) = stderr {
        let re_clone = re.clone();
        let tx_clone = tx.clone();
        let port_found_clone = port_found.clone();
        let output_buf = DEV_SERVER_OUTPUT.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err_stream);
            let mut captured = String::new();
            for line in reader.lines() {
                if let Ok(line) = line {
                    // Before port is found, keep capturing for error reporting
                    if !port_found_clone.load(std::sync::atomic::Ordering::Relaxed) {
                        if captured.len() < 2000 {
                            captured.push_str(&line);
                            captured.push('\n');
                        }
                        if let Some(caps) = re_clone.captures(&strip_ansi_codes(&line)) {
                            if let Some(port_str) = caps.get(1) {
                                if let Ok(port) = port_str.as_str().parse::<u16>() {
                                    port_found_clone.store(true, std::sync::atomic::Ordering::Relaxed);
                                    let _ = tx_clone.send(Ok(port));
                                }
                            }
                        }
                    }

                    // Always capture output after port is found (for error detection)
                    if port_found_clone.load(std::sync::atomic::Ordering::Relaxed) {
                        if let Ok(mut buf) = output_buf.lock() {
                            if buf.len() > 10_000 {
                                let cutoff = buf.len() - 5_000;
                                if let Some(pos) = buf[cutoff..].find('\n') {
                                    let new_start = cutoff + pos + 1;
                                    *buf = buf[new_start..].to_string();
                                }
                            }
                            buf.push_str(&line);
                            buf.push('\n');
                        }
                    }
                }
            }
            // Stream closed — if port was never found, report it
            if !port_found_clone.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = tx_clone.send(Err(format!(
                    "Dev server exited without starting. Output:\n{}",
                    if captured.is_empty() { "(no output)".to_string() } else { captured }
                )));
            }
        });
    }

    // Drop the extra sender so rx doesn't hang forever if both threads exit
    drop(tx);

    // Wait for a port with a 30-second timeout
    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(port)) => Ok(port),
        Ok(Err(e)) => {
            stop_dev_server_internal();
            Err(e)
        }
        Err(_) => {
            stop_dev_server_internal();
            Err("Dev server timed out after 30 seconds without printing a port. Try running the command manually in the terminal.".to_string())
        }
    }
}

/// Get buffered dev server output and clear the buffer.
/// Frontend polls this after AI finishes writing files to check for build errors.
#[tauri::command]
fn get_dev_server_output() -> String {
    let mut buf = DEV_SERVER_OUTPUT.lock().unwrap_or_else(|e| e.into_inner());
    let output = buf.clone();
    buf.clear();
    output
}

/// Internal helper to kill the dev server process tree
fn stop_dev_server_internal() {
    let pid = {
        let mut proc = DEV_SERVER_PROCESS.lock().unwrap_or_else(|e| e.into_inner());
        proc.take()
    };

    if let Some(pid) = pid {
        kill_process_tree(pid);
    }

    // Clear the output buffer
    if let Ok(mut buf) = DEV_SERVER_OUTPUT.lock() {
        buf.clear();
    }
}

/// Kill a process and all its children
fn kill_process_tree(pid: u32) {
    if cfg!(target_os = "windows") {
        // taskkill /T kills the tree, /F forces it
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let _ = cmd.output();
    } else {
        // Kill the process group on Unix
        let _ = std::process::Command::new("kill")
            .args(["-9", &format!("-{}", pid)])
            .output();
        // Fallback: kill just the process
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

/// Stop the dev server — exposed to frontend
#[tauri::command]
fn stop_dev_server() -> Result<(), String> {
    stop_dev_server_internal();
    Ok(())
}

// ── Supabase Management API Proxy ─────────────────────────────
// The Supabase Management API (api.supabase.com) doesn't set
// Access-Control-Allow-Origin, so browser/webview requests fail
// with CORS errors. This command proxies those calls through Rust.

#[derive(Serialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
async fn supabase_management_api(
    path: String,
    token: String,
    method: String,
    body: Option<String>,
) -> Result<ProxyResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("https://api.supabase.com{}", path);

    let mut request = match method.as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    request = request
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("User-Agent", "omnirun/1.0.0");

    if let Some(b) = body {
        request = request.body(b);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let response_body = response.text().await.map_err(|e| e.to_string())?;

    Ok(ProxyResponse { status, body: response_body })
}

// ── Resend API Proxy ───────────────────────────────────────────
// Resend API (api.resend.com) doesn't allow browser/webview requests
// due to missing CORS headers. Proxied through Rust via reqwest.

#[tauri::command]
async fn resend_api(
    path: String,
    token: String,
    method: String,
    body: Option<String>,
) -> Result<ProxyResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("https://api.resend.com{}", path);

    let mut request = match method.as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    request = request
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json");

    if let Some(b) = body {
        request = request.body(b);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let response_body = response.text().await.map_err(|e| e.to_string())?;

    Ok(ProxyResponse { status, body: response_body })
}

// ── Gmail API Proxy ──────────────────────────────────────────
// Gmail API doesn't allow browser/webview requests (CORS).
// Proxied through Rust, same pattern as supabase_management_api.

#[tauri::command]
async fn gmail_api_proxy(
    path: String,
    access_token: String,
    method: String,
    body: Option<String>,
) -> Result<ProxyResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("https://gmail.googleapis.com{}", path);

    let mut request = match method.as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    request = request
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json");

    if let Some(b) = body {
        request = request.body(b);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let response_body = response.text().await.map_err(|e| e.to_string())?;

    Ok(ProxyResponse { status, body: response_body })
}

// ── AI Streaming Proxy ────────────────────────────────────────
// Bypasses tauri-plugin-http for AI API calls to avoid streaming
// timeouts. Uses reqwest directly with no read/total timeout so
// long-running SSE streams (Opus thinking pauses, large outputs)
// never get killed mid-response.

#[derive(Serialize, Clone)]
struct StreamChunk {
    stream_id: String,
    data: String,
    done: bool,
    error: Option<String>,
    status: Option<u16>,
}

/// Stream an AI API request through Rust, bypassing tauri-plugin-http.
///
/// The command returns immediately. Chunks are emitted as Tauri events
/// named `ai-stream-{stream_id}`. The frontend listens for these events
/// and processes SSE data as it arrives.
///
/// Timeouts:
///   - connect_timeout: 300s (5 min) — covers Opus "thinking" delay
///   - read_timeout:    NONE — no mid-stream timeout
///   - total timeout:   NONE — stream can run indefinitely
#[tauri::command]
async fn stream_ai_request(
    app: tauri::AppHandle,
    url: String,
    headers: std::collections::HashMap<String, String>,
    body: String,
    stream_id: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(300))
        // Intentionally NO .timeout() — allows indefinite streaming
        // Intentionally NO .read_timeout() — pauses between chunks are expected
        .build()
        .map_err(|e| e.to_string())?;

    let event_name = format!("ai-stream-{}", stream_id);

    // Spawn the streaming work in a background task so invoke returns immediately
    tauri::async_runtime::spawn(async move {
        let mut request = client.post(&url);
        for (key, value) in &headers {
            request = request.header(key.as_str(), value.as_str());
        }
        request = request.body(body);

        // Send the request
        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit(&event_name, StreamChunk {
                    stream_id,
                    data: String::new(),
                    done: true,
                    error: Some(e.to_string()),
                    status: None,
                });
                return;
            }
        };

        let status = response.status().as_u16();

        // For error responses, read the full body and send it back
        if status >= 400 {
            let error_body = response.text().await.unwrap_or_default();
            let _ = app.emit(&event_name, StreamChunk {
                stream_id,
                data: error_body,
                done: true,
                error: Some(format!("HTTP {}", status)),
                status: Some(status),
            });
            return;
        }

        // Stream the response body chunk by chunk.
        // response.chunk() reads the next available bytes from the
        // underlying TCP stream. It returns None when the server
        // closes the connection (i.e., stream is complete).
        // Crucially, it will WAIT INDEFINITELY for the next chunk —
        // there is no read timeout that can kill it mid-stream.
        let mut response = response;
        loop {
            match response.chunk().await {
                Ok(Some(bytes)) => {
                    let chunk_str = String::from_utf8_lossy(&bytes).to_string();
                    let _ = app.emit(&event_name, StreamChunk {
                        stream_id: stream_id.clone(),
                        data: chunk_str,
                        done: false,
                        error: None,
                        status: Some(status),
                    });
                }
                Ok(None) => {
                    // Stream complete — server closed the connection
                    let _ = app.emit(&event_name, StreamChunk {
                        stream_id: stream_id.clone(),
                        data: String::new(),
                        done: true,
                        error: None,
                        status: Some(status),
                    });
                    break;
                }
                Err(e) => {
                    // Network error mid-stream
                    let _ = app.emit(&event_name, StreamChunk {
                        stream_id: stream_id.clone(),
                        data: String::new(),
                        done: true,
                        error: Some(e.to_string()),
                        status: Some(status),
                    });
                    break;
                }
            }
        }
    });

    Ok(())
}

// ── Scheduled Tasks IPC Commands ──────────────────────────────

#[tauri::command]
fn create_task(task: scheduler::ScheduledTask) -> Result<scheduler::ScheduledTask, String> {
    scheduler::create_task(task)
}

#[tauri::command]
fn update_task(task: scheduler::ScheduledTask) -> Result<scheduler::ScheduledTask, String> {
    scheduler::update_task(task)
}

#[tauri::command]
fn delete_task(task_id: String) -> Result<(), String> {
    scheduler::delete_task(&task_id)
}

#[tauri::command]
fn toggle_task(task_id: String) -> Result<scheduler::ScheduledTask, String> {
    scheduler::toggle_task(&task_id)
}

#[tauri::command]
fn get_tasks() -> Result<Vec<scheduler::ScheduledTask>, String> {
    scheduler::get_tasks()
}

#[tauri::command]
fn run_task_now(task_id: String) -> Result<(), String> {
    // Validate the task exists
    let _ = scheduler::get_task(&task_id)?;
    // Queue it for immediate execution
    scheduler::queue_run_now(&task_id);
    Ok(())
}

// ── Voice mute hotkey ─────────────────────────────────────────

#[tauri::command]
fn register_voice_mute_hotkey(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::Shortcut;

    // Unregister previous hotkey if any
    if let Some(prev_str) = VOICE_HOTKEY.lock().unwrap().take() {
        if let Ok(prev) = prev_str.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(prev);
        }
    }

    let shortcut: Shortcut = hotkey.parse()
        .map_err(|e| format!("Invalid hotkey '{}': {}", hotkey, e))?;

    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, _event| {
            // Emit event to frontend — voiceService.ts listens for this
            let _ = app_handle.emit("voice-mute-toggle", ());
        })
        .map_err(|e| format!("Failed to register voice mute hotkey: {}", e))?;

    *VOICE_HOTKEY.lock().unwrap() = Some(hotkey);
    Ok(())
}

#[tauri::command]
fn unregister_voice_mute_hotkey(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::Shortcut;

    if let Some(prev_str) = VOICE_HOTKEY.lock().unwrap().take() {
        if let Ok(prev) = prev_str.parse::<Shortcut>() {
            app.global_shortcut()
                .unregister(prev)
                .map_err(|e| format!("Failed to unregister voice mute hotkey: {}", e))?;
        }
    }
    Ok(())
}

// ── Screen control kill switch hotkey ─────────────────────────

#[tauri::command]
fn register_screen_kill_switch(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::Shortcut;

    // Unregister previous hotkey if any
    if let Some(prev_str) = SCREEN_KILL_SWITCH.lock().unwrap().take() {
        if let Ok(prev) = prev_str.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(prev);
        }
    }

    let shortcut: Shortcut = hotkey.parse()
        .map_err(|e| format!("Invalid hotkey '{}': {}", hotkey, e))?;

    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            // Only fire on key press, not release (matches old frontend behavior)
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                // Emit event to frontend — AssistantChatArea listens for this
                let _ = app_handle.emit("screen-kill-switch", ());
            }
        })
        .map_err(|e| format!("Failed to register kill switch hotkey: {}", e))?;

    *SCREEN_KILL_SWITCH.lock().unwrap() = Some(hotkey);
    Ok(())
}

#[tauri::command]
fn unregister_screen_kill_switch(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::Shortcut;

    if let Some(prev_str) = SCREEN_KILL_SWITCH.lock().unwrap().take() {
        if let Ok(prev) = prev_str.parse::<Shortcut>() {
            app.global_shortcut()
                .unregister(prev)
                .map_err(|e| format!("Failed to unregister kill switch hotkey: {}", e))?;
        }
    }
    Ok(())
}

// ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .setup(|app| {
            // Start the background scheduler on app launch
            scheduler::start_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_project_path,
            get_project_path,
            read_directory,
            read_file,
            get_file_size,
            write_file,
            create_directory,
            delete_path,
            execute_command,
            resolve_path,
            start_preview_server,
            stop_preview_server,
            set_selection_mode,
            set_preview_proxy,
            get_preview_port,
            start_dev_server,
            stop_dev_server,
            get_dev_server_output,
            // Supabase Management API proxy
            supabase_management_api,
            // Resend API proxy
            resend_api,
            // Gmail API proxy
            gmail_api_proxy,
            // AI streaming proxy (bypasses tauri-plugin-http timeout)
            stream_ai_request,
            // Scheduled tasks
            create_task,
            update_task,
            delete_task,
            toggle_task,
            get_tasks,
            run_task_now,
            // OAuth flows (Assistant integrations)
            oauth::start_gmail_oauth,
            oauth::start_outlook_oauth,
            oauth::start_google_calendar_oauth,
            oauth::start_outlook_calendar_oauth,
            oauth::start_slack_oauth,
            oauth::start_discord_oauth,
            oauth::start_github_oauth,
            oauth::start_notion_oauth,
            oauth::start_todoist_oauth,
            // Desktop app control (screen control)
            screen_control::take_screenshot,
            screen_control::screen_click,
            screen_control::screen_double_click,
            screen_control::screen_right_click,
            screen_control::screen_mouse_move,
            screen_control::screen_drag,
            screen_control::screen_scroll,
            screen_control::screen_type,
            screen_control::screen_key,
            screen_control::get_active_window,
            screen_control::get_screen_size,
            screen_control::get_virtual_desktop_size,
            screen_control::list_monitors,
            screen_control::launch_app,
            screen_control::scan_shortcuts_folder,
            screen_control::create_playlist,
            screen_control::get_omni_files_path,
            screen_control::minimize_self,
            // Voice control
            register_voice_mute_hotkey,
            unregister_voice_mute_hotkey,
            // Screen control kill switch
            register_screen_kill_switch,
            unregister_screen_kill_switch,
            // Voice engine (local wake word + whisper STT)
            voice_engine::init_voice_engine,
            voice_engine::shutdown_voice_engine,
            voice_engine::feed_audio_samples,
            voice_engine::start_capture,
            voice_engine::finish_capture,
            voice_engine::cancel_capture,
            voice_engine::set_wake_listening,
            voice_engine::set_voice_muted,
            voice_engine::set_voice_language,
            voice_engine::is_voice_engine_ready,
            // Direct-deploy (Vercel/Netlify/Cloudflare Pages)
            deploy::read_project_for_deploy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}