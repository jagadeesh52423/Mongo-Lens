#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod keychain;
mod mongo;
mod runner;
mod state;

use state::AppState;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn main() {
    if let Err(e) = run() {
        eprintln!("Mongo Lens failed to start: {}", e);
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let base = dirs_dir()?;
            fs::create_dir_all(&base)
                .map_err(|e| format!("failed to create app dir {}: {}", base.display(), e))?;
            let db_path = base.join("mongomacapp.sqlite");
            db::open(&db_path)
                .map_err(|e| format!("failed to open/migrate sqlite at {}: {}", db_path.display(), e))?;
            app.manage(AppState::new(db_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect_connection,
            commands::connection::disconnect_connection,
            commands::collection::list_databases,
            commands::collection::list_collections,
            commands::collection::list_indexes,
            commands::collection::browse_collection,
            commands::document::update_document,
            commands::document::delete_document,
            commands::script::run_script,
            commands::script::cancel_script,
            commands::saved_script::list_scripts,
            commands::saved_script::create_script,
            commands::saved_script::update_script,
            commands::saved_script::delete_script,
            commands::saved_script::touch_script,
            runner::executor::check_node_runner,
            runner::executor::install_node_runner,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}

fn dirs_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME environment variable is not set".to_string())?;
    Ok(PathBuf::from(home).join(".mongomacapp"))
}
