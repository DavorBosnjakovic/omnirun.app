// ============================================================
// screen_control.rs
// ============================================================
// Desktop app control via screenshot + input simulation.
// Cross-platform: Windows, Mac, Linux.
//
// Tauri commands:
// - take_screenshot, screen_click, screen_double_click, screen_right_click
// - screen_mouse_move, screen_drag, screen_scroll, screen_type, screen_key
// - get_active_window, get_screen_size, list_monitors
// - launch_app: open an app by name/path with optional file
// - scan_shortcuts_folder: list launchable shortcuts in user's app folder
// - create_playlist: scan music folder → create .m3u file
// - minimize_self: minimize Omnirun window

use serde::{Deserialize, Serialize};
use std::thread;
use std::time::Duration;
use enigo::{
    Enigo,
    Keyboard as EnigoKeyboard,
    Mouse as EnigoMouse,
    Settings as EnigoSettings,
    Coordinate,
    Button,
    Direction,
    Key,
};
use base64::Engine;

// ── Types ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ScreenshotResult {
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ActiveWindow {
    pub app_name: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScreenSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShortcutEntry {
    pub name: String,       // "Photoshop" (filename without extension)
    pub path: String,       // full path to the .lnk / .exe / .url file
    pub extension: String,  // "lnk", "exe", "url"
}

// ── Monitor Enumeration ───────────────────────────────────────

#[tauri::command]
pub fn list_monitors() -> Result<Vec<MonitorInfo>, String> {
    let screens = screenshots::Screen::all().map_err(|e| format!("Failed to enumerate screens: {}", e))?;

    let monitors: Vec<MonitorInfo> = screens.iter().enumerate().map(|(i, s)| {
        MonitorInfo {
            index: i,
            name: format!("Monitor {} ({}x{})", i + 1, s.display_info.width, s.display_info.height),
            width: s.display_info.width,
            height: s.display_info.height,
            x: s.display_info.x,
            y: s.display_info.y,
            is_primary: s.display_info.is_primary,
        }
    }).collect();

    Ok(monitors)
}

// ── Screenshot ────────────────────────────────────────────────

#[tauri::command]
pub fn take_screenshot(monitor_index: usize, crop_to_window: bool, quality: String) -> Result<ScreenshotResult, String> {
    let screens = screenshots::Screen::all().map_err(|e| format!("Failed to enumerate screens: {}", e))?;

    let screen = if monitor_index < screens.len() {
        &screens[monitor_index]
    } else {
        screens.first().ok_or("No screens found")?
    };

    let captured = if crop_to_window {
        match get_active_window_info() {
            Ok(win) if win.width > 100 && win.height > 100 => {
                let screen_w = screen.display_info.width as i32;
                let screen_h = screen.display_info.height as i32;
                let x = win.x.max(0);
                let y = win.y.max(0);
                let w = ((win.width as i32).min(screen_w - x)).max(0) as u32;
                let h = ((win.height as i32).min(screen_h - y)).max(0) as u32;

                if w >= 100 && h >= 100 {
                    screen.capture_area(x, y, w, h)
                        .unwrap_or_else(|_| screen.capture().unwrap())
                } else {
                    screen.capture().map_err(|e| format!("Screenshot failed: {}", e))?
                }
            }
            _ => {
                screen.capture().map_err(|e| format!("Screenshot failed: {}", e))?
            }
        }
    } else {
        screen.capture().map_err(|e| format!("Screenshot failed: {}", e))?
    };

    let raw_width = captured.width();
    let raw_height = captured.height();

    let (target_w, target_h) = match quality.as_str() {
        "low" => scale_dimensions(raw_width, raw_height, 960),
        "medium" => scale_dimensions(raw_width, raw_height, 1280),
        _ => (raw_width, raw_height),
    };

    let dynamic = image::DynamicImage::ImageRgba8(captured);

    let final_img = if target_w != raw_width || target_h != raw_height {
        dynamic.resize(target_w, target_h, image::imageops::FilterType::Triangle)
    } else {
        dynamic
    };

    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    final_img
        .write_to(&mut cursor, image::ImageOutputFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

    Ok(ScreenshotResult {
        base64: b64,
        width: final_img.width(),
        height: final_img.height(),
        mime_type: "image/png".to_string(),
    })
}

fn scale_dimensions(w: u32, h: u32, max_width: u32) -> (u32, u32) {
    if w <= max_width {
        return (w, h);
    }
    let ratio = max_width as f64 / w as f64;
    let new_h = (h as f64 * ratio).round() as u32;
    (max_width, new_h)
}

// ── Mouse Actions ─────────────────────────────────────────────

#[tauri::command]
pub fn screen_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(50));
    enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn screen_double_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(50));
    enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(80));
    enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn screen_right_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(50));
    enigo.button(Button::Right, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn screen_mouse_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn screen_drag(x1: i32, y1: i32, x2: i32, y2: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x1, y1, Coordinate::Abs).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(50));
    enigo.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(100));
    let steps = 10;
    for i in 1..=steps {
        let cx = x1 + (x2 - x1) * i / steps;
        let cy = y1 + (y2 - y1) * i / steps;
        enigo.move_mouse(cx, cy, Coordinate::Abs).map_err(|e| e.to_string())?;
        thread::sleep(Duration::from_millis(20));
    }
    enigo.button(Button::Left, Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Scroll ────────────────────────────────────────────────────

#[tauri::command]
pub fn screen_scroll(direction: String, amount: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    let ticks = amount.max(1);
    for _ in 0..ticks {
        match direction.as_str() {
            "up" => enigo.scroll(1, enigo::Axis::Vertical).map_err(|e| e.to_string())?,
            "down" => enigo.scroll(-1, enigo::Axis::Vertical).map_err(|e| e.to_string())?,
            "left" => enigo.scroll(-1, enigo::Axis::Horizontal).map_err(|e| e.to_string())?,
            "right" => enigo.scroll(1, enigo::Axis::Horizontal).map_err(|e| e.to_string())?,
            _ => return Err(format!("Invalid scroll direction: {}", direction)),
        }
        thread::sleep(Duration::from_millis(30));
    }
    Ok(())
}

// ── Keyboard ──────────────────────────────────────────────────

#[tauri::command]
pub fn screen_type(text: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn screen_key(combo: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;

    let parts: Vec<&str> = combo.split('+').map(|s| s.trim().to_lowercase().leak() as &str).collect();

    let mut modifiers: Vec<Key> = Vec::new();
    let mut final_key: Option<Key> = None;

    for (i, part) in parts.iter().enumerate() {
        let key = parse_key(part)?;
        if i < parts.len() - 1 {
            modifiers.push(key);
        } else {
            final_key = Some(key);
        }
    }

    let final_key = final_key.ok_or("No key specified in combo")?;

    for m in &modifiers {
        enigo.key(*m, Direction::Press).map_err(|e| e.to_string())?;
    }

    enigo.key(final_key, Direction::Click).map_err(|e| e.to_string())?;

    for m in modifiers.iter().rev() {
        enigo.key(*m, Direction::Release).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn parse_key(name: &str) -> Result<Key, String> {
    match name.to_lowercase().as_str() {
        "ctrl" | "control" => Ok(Key::Control),
        "alt" | "option" => Ok(Key::Alt),
        "shift" => Ok(Key::Shift),
        "meta" | "win" | "cmd" | "command" | "super" => Ok(Key::Meta),
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "escape" | "esc" => Ok(Key::Escape),
        "backspace" => Ok(Key::Backspace),
        "delete" | "del" => Ok(Key::Delete),
        "space" => Ok(Key::Space),
        "up" | "arrowup" => Ok(Key::UpArrow),
        "down" | "arrowdown" => Ok(Key::DownArrow),
        "left" | "arrowleft" => Ok(Key::LeftArrow),
        "right" | "arrowright" => Ok(Key::RightArrow),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" | "pgup" => Ok(Key::PageUp),
        "pagedown" | "pgdown" => Ok(Key::PageDown),
        "f1" => Ok(Key::F1),   "f2" => Ok(Key::F2),   "f3" => Ok(Key::F3),
        "f4" => Ok(Key::F4),   "f5" => Ok(Key::F5),   "f6" => Ok(Key::F6),
        "f7" => Ok(Key::F7),   "f8" => Ok(Key::F8),   "f9" => Ok(Key::F9),
        "f10" => Ok(Key::F10), "f11" => Ok(Key::F11), "f12" => Ok(Key::F12),
        s if s.len() == 1 => {
            let c = s.chars().next().unwrap();
            Ok(Key::Unicode(c))
        }
        _ => Err(format!("Unknown key: '{}'", name)),
    }
}

// ── Active Window Detection ───────────────────────────────────

#[tauri::command]
pub fn get_active_window() -> Result<ActiveWindow, String> {
    get_active_window_info()
}

#[tauri::command]
pub fn get_screen_size(monitor_index: usize) -> Result<ScreenSize, String> {
    let screens = screenshots::Screen::all().map_err(|e| format!("Failed to enumerate screens: {}", e))?;
    let screen = if monitor_index < screens.len() {
        &screens[monitor_index]
    } else {
        screens.first().ok_or("No screens found")?
    };
    Ok(ScreenSize {
        width: screen.display_info.width,
        height: screen.display_info.height,
    })
}

// ── App Launch (scripted — no AI needed) ──────────────────────

#[tauri::command]
pub fn launch_app(app: String, file: Option<String>) -> Result<String, String> {
    launch_app_platform(&app, file.as_deref())
}

#[cfg(target_os = "windows")]
fn launch_app_platform(app: &str, file: Option<&str>) -> Result<String, String> {
    use std::process::Command;

    let app_lower = app.to_lowercase();
    let is_shortcut = app_lower.ends_with(".lnk") || app_lower.ends_with(".url");
    let is_full_path = app.contains('\\') || app.contains('/');

    // Only spawn directly for full-path .exe files (not shortcuts).
    // .lnk and .url are Shell Links — they MUST go through cmd /C start.
    // App names (notepad, wmplayer) also go through cmd /C start.
    if is_full_path && !is_shortcut {
        let mut cmd = Command::new(app);
        if let Some(f) = file {
            cmd.arg(f);
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.spawn().map_err(|e| format!("Failed to launch '{}': {}", app, e))?;
        return Ok(format!("Launched {}", app));
    }

    // cmd /C start handles: app names, .lnk shortcuts, .url shortcuts
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg("start").arg(""); // empty title for start command
    cmd.arg(app);
    if let Some(f) = file {
        cmd.arg(f);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| format!("Failed to launch '{}': {}", app, e))?;
    Ok(format!("Launched {}", app))
}

#[cfg(target_os = "macos")]
fn launch_app_platform(app: &str, file: Option<&str>) -> Result<String, String> {
    use std::process::Command;
    let mut cmd = Command::new("open");
    if let Some(f) = file {
        cmd.arg("-a").arg(app).arg(f);
    } else {
        cmd.arg("-a").arg(app);
    }
    cmd.spawn().map_err(|e| format!("Failed to launch '{}': {}", app, e))?;
    Ok(format!("Launched {}", app))
}

#[cfg(target_os = "linux")]
fn launch_app_platform(app: &str, file: Option<&str>) -> Result<String, String> {
    use std::process::Command;
    if let Some(f) = file {
        let result = Command::new(app).arg(f).spawn();
        match result {
            Ok(_) => return Ok(format!("Launched {} with {}", app, f)),
            Err(_) => {
                Command::new("xdg-open").arg(f).spawn()
                    .map_err(|e| format!("Failed to open '{}': {}", f, e))?;
                return Ok(format!("Opened {} with default app", f));
            }
        }
    }
    Command::new(app).spawn()
        .map_err(|e| format!("Failed to launch '{}': {}", app, e))?;
    Ok(format!("Launched {}", app))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn launch_app_platform(app: &str, _file: Option<&str>) -> Result<String, String> {
    Err(format!("App launching not supported on this platform for '{}'", app))
}

// ── Scan Shortcuts Folder ─────────────────────────────────────
// Lists all launchable files in the user's app shortcuts folder.
// Users drop .lnk (Windows shortcuts), .exe, .url, or .app files
// into this folder. Omnirun scans it to know what apps are available.

#[tauri::command]
pub fn scan_shortcuts_folder(folder: String) -> Result<Vec<ShortcutEntry>, String> {
    use std::path::Path;

    let folder_path = Path::new(&folder);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("Folder not found: {}", folder));
    }

    let launchable_extensions = ["lnk", "exe", "url", "app", "command", "sh", "desktop"];
    let mut entries: Vec<ShortcutEntry> = Vec::new();

    let dir = std::fs::read_dir(folder_path)
        .map_err(|e| format!("Failed to read folder: {}", e))?;

    for entry in dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if !launchable_extensions.contains(&ext.as_str()) {
            continue;
        }

        let name = path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        if name.is_empty() {
            continue;
        }

        entries.push(ShortcutEntry {
            name,
            path: path.to_string_lossy().to_string(),
            extension: ext,
        });
    }

    // Sort alphabetically
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(entries)
}

// ── Playlist Creator (scripted — no AI needed) ────────────────

#[tauri::command]
pub fn create_playlist(folder: String, output_path: Option<String>) -> Result<String, String> {
    use std::path::Path;

    let folder_path = Path::new(&folder);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("Folder not found: {}", folder));
    }

    let music_extensions = ["mp3", "wav", "flac", "m4a", "wma", "ogg", "aac", "opus"];
    let mut tracks: Vec<String> = Vec::new();

    fn scan_dir(dir: &Path, extensions: &[&str], tracks: &mut Vec<String>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut paths: Vec<std::path::PathBuf> = entries
                .filter_map(|e| e.ok().map(|e| e.path()))
                .collect();
            paths.sort();

            for path in paths {
                if path.is_dir() {
                    scan_dir(&path, extensions, tracks);
                } else if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if extensions.contains(&ext_lower.as_str()) {
                        tracks.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    use std::path::Path as StdPath;
    scan_dir(folder_path, &music_extensions, &mut tracks);

    if tracks.is_empty() {
        return Err(format!("No music files found in {}", folder));
    }

    let playlist_path = match output_path {
        Some(p) => p,
        None => folder_path.join("omnirun_playlist.m3u").to_string_lossy().to_string(),
    };

    let mut content = String::from("#EXTM3U\n");
    for track in &tracks {
        content.push_str(track);
        content.push('\n');
    }

    std::fs::write(&playlist_path, &content)
        .map_err(|e| format!("Failed to write playlist: {}", e))?;

    Ok(playlist_path)
}

// ── Minimize Self ─────────────────────────────────────────────

#[tauri::command]
pub fn minimize_self(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| format!("Failed to minimize window: {}", e))?;
    thread::sleep(Duration::from_millis(300));
    Ok(())
}

// ── Platform-specific active window implementation ────────────

#[cfg(target_os = "windows")]
fn get_active_window_info() -> Result<ActiveWindow, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    let hwnd = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
    if hwnd.is_null() {
        return Err("No foreground window".to_string());
    }

    let mut title_buf: [u16; 512] = [0; 512];
    let title_len = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowTextW(
            hwnd,
            title_buf.as_mut_ptr(),
            512,
        )
    };
    let title = OsString::from_wide(&title_buf[..title_len as usize])
        .to_string_lossy()
        .to_string();

    let mut pid: u32 = 0;
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);
    }
    let app_name = get_process_name_win(pid).unwrap_or_else(|_| "Unknown".to_string());

    let mut rect = windows_sys::Win32::Foundation::RECT {
        left: 0, top: 0, right: 0, bottom: 0,
    };
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut rect);
    }

    Ok(ActiveWindow {
        app_name,
        title,
        x: rect.left,
        y: rect.top,
        width: (rect.right - rect.left) as u32,
        height: (rect.bottom - rect.top) as u32,
    })
}

#[cfg(target_os = "windows")]
fn get_process_name_win(pid: u32) -> Result<String, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    let handle = unsafe {
        windows_sys::Win32::System::Threading::OpenProcess(
            windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        )
    };
    if handle.is_null() {
        return Err("Failed to open process".to_string());
    }

    let mut buf: [u16; 260] = [0; 260];
    let mut size: u32 = 260;
    let ok = unsafe {
        windows_sys::Win32::System::Threading::QueryFullProcessImageNameW(
            handle,
            0,
            buf.as_mut_ptr(),
            &mut size,
        )
    };
    unsafe {
        windows_sys::Win32::Foundation::CloseHandle(handle);
    }

    if ok == 0 {
        return Err("Failed to query process name".to_string());
    }

    let full_path = OsString::from_wide(&buf[..size as usize])
        .to_string_lossy()
        .to_string();

    let name = full_path
        .rsplit('\\')
        .next()
        .unwrap_or(&full_path)
        .trim_end_matches(".exe")
        .to_string();

    Ok(name)
}

#[cfg(target_os = "macos")]
fn get_active_window_info() -> Result<ActiveWindow, String> {
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(r#"
            tell application "System Events"
                set frontApp to first application process whose frontmost is true
                set appName to name of frontApp
                try
                    set winTitle to name of front window of frontApp
                on error
                    set winTitle to ""
                end try
                try
                    set winPos to position of front window of frontApp
                    set winSize to size of front window of frontApp
                    return appName & "|" & winTitle & "|" & (item 1 of winPos) & "|" & (item 2 of winPos) & "|" & (item 1 of winSize) & "|" & (item 2 of winSize)
                on error
                    return appName & "|" & winTitle & "|0|0|0|0"
                end try
            end tell
        "#)
        .output()
        .map_err(|e| format!("osascript failed: {}", e))?;

    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = result.split('|').collect();

    if parts.len() >= 6 {
        Ok(ActiveWindow {
            app_name: parts[0].to_string(),
            title: parts[1].to_string(),
            x: parts[2].parse().unwrap_or(0),
            y: parts[3].parse().unwrap_or(0),
            width: parts[4].parse().unwrap_or(0),
            height: parts[5].parse().unwrap_or(0),
        })
    } else if parts.len() >= 2 {
        Ok(ActiveWindow {
            app_name: parts[0].to_string(),
            title: parts[1].to_string(),
            x: 0, y: 0, width: 0, height: 0,
        })
    } else {
        Err("Failed to parse active window info".to_string())
    }
}

#[cfg(target_os = "linux")]
fn get_active_window_info() -> Result<ActiveWindow, String> {
    let id_output = std::process::Command::new("xdotool")
        .arg("getactivewindow")
        .output()
        .map_err(|e| format!("xdotool not found: {}", e))?;

    let window_id = String::from_utf8_lossy(&id_output.stdout).trim().to_string();
    if window_id.is_empty() {
        return Err("No active window found".to_string());
    }

    let name_output = std::process::Command::new("xdotool")
        .args(["getwindowname", &window_id])
        .output()
        .map_err(|e| e.to_string())?;
    let title = String::from_utf8_lossy(&name_output.stdout).trim().to_string();

    let pid_output = std::process::Command::new("xdotool")
        .args(["getwindowpid", &window_id])
        .output()
        .map_err(|e| e.to_string())?;
    let pid = String::from_utf8_lossy(&pid_output.stdout).trim().to_string();

    let app_name = if !pid.is_empty() {
        std::fs::read_to_string(format!("/proc/{}/comm", pid))
            .unwrap_or_else(|_| "Unknown".to_string())
            .trim()
            .to_string()
    } else {
        "Unknown".to_string()
    };

    let geo_output = std::process::Command::new("xdotool")
        .args(["getwindowgeometry", "--shell", &window_id])
        .output()
        .map_err(|e| e.to_string())?;
    let geo = String::from_utf8_lossy(&geo_output.stdout);

    let mut x = 0i32;
    let mut y = 0i32;
    let mut width = 0u32;
    let mut height = 0u32;

    for line in geo.lines() {
        if let Some(val) = line.strip_prefix("X=") {
            x = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("Y=") {
            y = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("WIDTH=") {
            width = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("HEIGHT=") {
            height = val.parse().unwrap_or(0);
        }
    }

    Ok(ActiveWindow {
        app_name,
        title,
        x,
        y,
        width,
        height,
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn get_active_window_info() -> Result<ActiveWindow, String> {
    Err("Active window detection not supported on this platform".to_string())
}