// Omnirun Admin - Tauri backend
//
// Intentionally minimal. All data lives in Supabase and is accessed directly
// from the React frontend via @supabase/supabase-js. The backend only provides
// the desktop window shell and shell.open() for external links.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}