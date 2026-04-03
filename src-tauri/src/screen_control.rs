// ============================================================
// screen_control.rs
// ============================================================
// Desktop app control via screenshot + input simulation.
// Cross-platform: Windows (SendInput/BitBlt), Mac (CGEvent/CGWindowList), Linux (X11).
//
// Provides Tauri commands for:
// - take_screenshot: capture full screen or active window, return base64 PNG
// - screen_click: simulate mouse click at (x, y)
// - screen_double_click: simulate double-click at (x, y)
// - screen_right_click: simulate right-click at (x, y)
// - screen_type: type text string
// - screen_key: press key combination (e.g. "ctrl+s")
// - screen_scroll: scroll in a direction
// - screen_drag: click-drag from (x1,y1) to (x2,y2)
// - screen_mouse_move: move mouse to (x, y) without clicking
// - get_active_window: return app name, title, and dimensions
// - get_screen_size: return primary monitor dimensions
// - launch_app: open an app by name/path, optionally with a file argument
// - minimize_self: minimize the Omnirun window to get out of the way

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

// ── Monitor Enumeration ───────────────────────────────────────

/// List all available monitors with their dimensions and positions.
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

/// Take a screenshot.
/// `monitor_index`: which monitor (0 = first/primary). Use list_monitors to enumerate.
/// `crop_to_window`: if true, crop to active window bounds (falls back to full screen if window is too small).
/// `quality`: "low" = 960px, "medium" = 1280px, "high" = full res.
#[tauri::command]
pub fn take_screenshot(monitor_index: usize, crop_to_window: bool, quality: String) -> Result<ScreenshotResult, String> {
    let screens = screenshots::Screen::all().map_err(|e| format!("Failed to enumerate screens: {}", e))?;

    let screen = if monitor_index < screens.len() {
        &screens[monitor_index]
    } else {
        screens.first().ok_or("No screens found")?
    };

    let captured = if crop_to_window {
        // Try to get active window bounds and capture just that region
        match get_active_window_info() {
            Ok(win) if win.width > 100 && win.height > 100 => {
                // Clamp capture region to screen bounds
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
                    // Window is mostly off-screen, capture full screen
                    screen.capture().map_err(|e| format!("Screenshot failed: {}", e))?
                }
            }
            _ => {
                // Fallback to full screen
                screen.capture().map_err(|e| format!("Screenshot failed: {}", e))?
            }
        }
    } else {
        screen.capture().map_err(|e| format!("Screenshot failed: {}", e))?
    };

    // The `screenshots` crate returns an ImageBuffer<Rgba<u8>, Vec<u8>>.
    let raw_width = captured.width();
    let raw_height = captured.height();

    // Determine target dimensions based on quality
    let (target_w, target_h) = match quality.as_str() {
        "low" => scale_dimensions(raw_width, raw_height, 960),
        "medium" => scale_dimensions(raw_width, raw_height, 1280),
        _ => (raw_width, raw_height), // "high" or default = full res
    };

    // Wrap in DynamicImage for resize + PNG encode
    let dynamic = image::DynamicImage::ImageRgba8(captured);

    let final_img = if target_w != raw_width || target_h != raw_height {
        dynamic.resize(target_w, target_h, image::imageops::FilterType::Triangle)
    } else {
        dynamic
    };

    // Encode to PNG
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

/// Scale dimensions to fit within max_width while preserving aspect ratio.
fn scale_dimensions(w: u32, h: u32, max_width: u32) -> (u32, u32) {
    if w <= max_width {
        return (w, h);
    }
    let ratio = max_width as f64 / w as f64;
    let new_h = (h as f64 * ratio).round() as u32;
    (max_width, new_h)
}

// ── Mouse Actions ─────────────────────────────────────────────

/// Move mouse to (x, y) and perform a left click.
#[tauri::command]
pub fn screen_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(50));
    enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

/// Move mouse to (x, y) and perform a double left click.
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

/// Move mouse to (x, y) and perform a right click.
#[tauri::command]
pub fn screen_right_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(50));
    enigo.button(Button::Right, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

/// Move mouse to (x, y) without clicking.
#[tauri::command]
pub fn screen_mouse_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    Ok(())
}

/// Click-drag from (x1, y1) to (x2, y2).
#[tauri::command]
pub fn screen_drag(x1: i32, y1: i32, x2: i32, y2: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x1, y1, Coordinate::Abs).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(50));
    enigo.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(100));
    // Move in small steps for smooth drag
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

/// Scroll in a direction. `amount` is number of scroll ticks.
/// `direction`: "up", "down", "left", "right"
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
            _ => return Err(format!("Invalid scroll direction: {}. Use up/down/left/right", direction)),
        }
        thread::sleep(Duration::from_millis(30));
    }
    Ok(())
}

// ── Keyboard ──────────────────────────────────────────────────

/// Type a text string with natural keystrokes.
#[tauri::command]
pub fn screen_type(text: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    enigo.text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

/// Press a key combination like "ctrl+s", "enter", "alt+tab", "shift+ctrl+n".
/// Supports modifier keys: ctrl, alt, shift, meta/win/cmd.
/// Supports special keys: enter, tab, escape, backspace, delete, space, up, down, left, right,
///   home, end, pageup, pagedown, f1-f12.
#[tauri::command]
pub fn screen_key(combo: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;

    let parts: Vec<&str> = combo.split('+').map(|s| s.trim().to_lowercase().leak() as &str).collect();

    // Separate modifiers from the final key
    let mut modifiers: Vec<Key> = Vec::new();
    let mut final_key: Option<Key> = None;

    for (i, part) in parts.iter().enumerate() {
        let key = parse_key(part)?;
        if i < parts.len() - 1 {
            // All but last are modifiers
            modifiers.push(key);
        } else {
            final_key = Some(key);
        }
    }

    let final_key = final_key.ok_or("No key specified in combo")?;

    // Press modifiers
    for m in &modifiers {
        enigo.key(*m, Direction::Press).map_err(|e| e.to_string())?;
    }

    // Press and release the final key
    enigo.key(final_key, Direction::Click).map_err(|e| e.to_string())?;

    // Release modifiers (reverse order)
    for m in modifiers.iter().rev() {
        enigo.key(*m, Direction::Release).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Parse a key name string into an enigo Key enum.
fn parse_key(name: &str) -> Result<Key, String> {
    match name.to_lowercase().as_str() {
        // Modifiers
        "ctrl" | "control" => Ok(Key::Control),
        "alt" | "option" => Ok(Key::Alt),
        "shift" => Ok(Key::Shift),
        "meta" | "win" | "cmd" | "command" | "super" => Ok(Key::Meta),

        // Special keys
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "escape" | "esc" => Ok(Key::Escape),
        "backspace" => Ok(Key::Backspace),
        "delete" | "del" => Ok(Key::Delete),
        "space" => Ok(Key::Space),

        // Arrow keys
        "up" | "arrowup" => Ok(Key::UpArrow),
        "down" | "arrowdown" => Ok(Key::DownArrow),
        "left" | "arrowleft" => Ok(Key::LeftArrow),
        "right" | "arrowright" => Ok(Key::RightArrow),

        // Navigation
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" | "pgup" => Ok(Key::PageUp),
        "pagedown" | "pgdown" => Ok(Key::PageDown),

        // Function keys
        "f1" => Ok(Key::F1),
        "f2" => Ok(Key::F2),
        "f3" => Ok(Key::F3),
        "f4" => Ok(Key::F4),
        "f5" => Ok(Key::F5),
        "f6" => Ok(Key::F6),
        "f7" => Ok(Key::F7),
        "f8" => Ok(Key::F8),
        "f9" => Ok(Key::F9),
        "f10" => Ok(Key::F10),
        "f11" => Ok(Key::F11),
        "f12" => Ok(Key::F12),

        // Single character keys
        s if s.len() == 1 => {
            let c = s.chars().next().unwrap();
            Ok(Key::Unicode(c))
        }

        _ => Err(format!("Unknown key: '{}'. Use: ctrl, alt, shift, meta, enter, tab, escape, backspace, delete, space, up/down/left/right, home, end, pageup, pagedown, f1-f12, or a single character.", name)),
    }
}

// ── Active Window Detection ───────────────────────────────────

/// Get info about the currently focused/active window.
#[tauri::command]
pub fn get_active_window() -> Result<ActiveWindow, String> {
    get_active_window_info()
}

/// Get the screen dimensions for a specific monitor.
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

// ── App Launch (scripted pre-step — no AI needed) ─────────────

/// Launch an application by name or path, optionally opening a file in it.
/// This is the "scripted" part of screen control — instant, free, no AI tokens.
///
/// Examples:
///   launch_app("notepad", None)              → opens Notepad
///   launch_app("notepad", Some("C:\\readme.txt"))  → opens file in Notepad
///   launch_app("C:\\Program Files\\WMP\\wmplayer.exe", Some("D:\\Music")) → opens WMP with folder
///
/// On Windows: uses `cmd /C start` for app names, direct spawn for full paths.
/// On Mac: uses `open -a` for app names, `open` for files.
/// On Linux: spawns directly or uses `xdg-open` for files.
#[tauri::command]
pub fn launch_app(app: String, file: Option<String>) -> Result<String, String> {
    launch_app_platform(&app, file.as_deref())
}

#[cfg(target_os = "windows")]
fn launch_app_platform(app: &str, file: Option<&str>) -> Result<String, String> {
    use std::process::Command;

    // If app looks like a full path (contains \ or /), spawn directly
    if app.contains('\\') || app.contains('/') {
        let mut cmd = Command::new(app);
        if let Some(f) = file {
            cmd.arg(f);
        }
        // CREATE_NO_WINDOW flag to avoid flashing console
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.spawn().map_err(|e| format!("Failed to launch '{}': {}", app, e))?;
        return Ok(format!("Launched {}", app));
    }

    // For app names (notepad, wmplayer, excel, etc.), use `cmd /C start`
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg("start").arg(""); // empty title for start command
    cmd.arg(app);
    if let Some(f) = file {
        cmd.arg(f);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn().map_err(|e| format!("Failed to launch '{}': {}", app, e))?;
    Ok(format!("Launched {}", app))
}

#[cfg(target_os = "macos")]
fn launch_app_platform(app: &str, file: Option<&str>) -> Result<String, String> {
    use std::process::Command;

    let mut cmd = Command::new("open");
    if let Some(f) = file {
        // open file with specific app: open -a "App" "file"
        cmd.arg("-a").arg(app).arg(f);
    } else {
        // Just launch app: open -a "App"
        cmd.arg("-a").arg(app);
    }
    cmd.spawn().map_err(|e| format!("Failed to launch '{}': {}", app, e))?;
    Ok(format!("Launched {}", app))
}

#[cfg(target_os = "linux")]
fn launch_app_platform(app: &str, file: Option<&str>) -> Result<String, String> {
    use std::process::Command;

    if let Some(f) = file {
        // Try launching app with file argument
        let result = Command::new(app).arg(f).spawn();
        match result {
            Ok(_) => return Ok(format!("Launched {} with {}", app, f)),
            Err(_) => {
                // Fallback: open file with xdg-open (ignores app param)
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

// ── Minimize Self (get Omnirun out of the way) ────────────────

/// Minimize the Omnirun window so it doesn't interfere with screen control.
/// Called before the AI screenshot loop starts to ensure the target app is visible.
#[tauri::command]
pub fn minimize_self(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| format!("Failed to minimize window: {}", e))?;
    // Small delay to let the window animation complete before first screenshot
    thread::sleep(Duration::from_millis(300));
    Ok(())
}

// ── Platform-specific active window implementation ────────────

#[cfg(target_os = "windows")]
fn get_active_window_info() -> Result<ActiveWindow, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    // Get foreground window handle
    let hwnd = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
    if hwnd.is_null() {
        return Err("No foreground window".to_string());
    }

    // Get window title
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

    // Get process name
    let mut pid: u32 = 0;
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);
    }
    let app_name = get_process_name_win(pid).unwrap_or_else(|_| "Unknown".to_string());

    // Get window rect
    let mut rect = windows_sys::Win32::Foundation::RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
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
            0, // FALSE
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

    // Extract just the filename without extension
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
    // Use osascript to get active window info on macOS
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
    // Use xdotool to get active window info on Linux (X11)
    let id_output = std::process::Command::new("xdotool")
        .arg("getactivewindow")
        .output()
        .map_err(|e| format!("xdotool not found: {}. Install with: sudo apt install xdotool", e))?;

    let window_id = String::from_utf8_lossy(&id_output.stdout).trim().to_string();
    if window_id.is_empty() {
        return Err("No active window found".to_string());
    }

    // Get window name
    let name_output = std::process::Command::new("xdotool")
        .args(["getwindowname", &window_id])
        .output()
        .map_err(|e| e.to_string())?;
    let title = String::from_utf8_lossy(&name_output.stdout).trim().to_string();

    // Get window PID for app name
    let pid_output = std::process::Command::new("xdotool")
        .args(["getwindowpid", &window_id])
        .output()
        .map_err(|e| e.to_string())?;
    let pid = String::from_utf8_lossy(&pid_output.stdout).trim().to_string();

    let app_name = if !pid.is_empty() {
        // Read /proc/<pid>/comm for the process name
        std::fs::read_to_string(format!("/proc/{}/comm", pid))
            .unwrap_or_else(|_| "Unknown".to_string())
            .trim()
            .to_string()
    } else {
        "Unknown".to_string()
    };

    // Get window geometry
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

// Fallback for any other OS (shouldn't happen with Tauri targets)
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn get_active_window_info() -> Result<ActiveWindow, String> {
    Err("Active window detection not supported on this platform".to_string())
}