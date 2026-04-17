#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod state;

use state::AppState;
use std::fs;

fn main() {
    let base = dirs_dir();
    fs::create_dir_all(&base).expect("create app dir");
    let db_path = base.join("mongomacapp.sqlite");
    let _ = db::open(&db_path).expect("open & migrate sqlite");
    let app_state = AppState::new(db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".mongomacapp")
}
