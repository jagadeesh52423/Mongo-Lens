#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod keychain;
mod logger;
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
            let logs_dir = base.join("logs");
            fs::create_dir_all(&logs_dir)
                .map_err(|e| format!("failed to create logs dir {}: {}", logs_dir.display(), e))?;
            // Spec §File layout: logs dir must be 0700 so other local users can't
            // read another user's potentially-sensitive log entries. Unix-only —
            // Windows has its own ACL model and is not a target platform here.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&logs_dir, fs::Permissions::from_mode(0o700)).map_err(|e| {
                    format!("failed to set 0700 on logs dir {}: {}", logs_dir.display(), e)
                })?;
            }

            let level = std::env::var("MONGOMACAPP_LOG_LEVEL")
                .ok()
                .map(|s| logger::Level::from_str(&s))
                .unwrap_or(logger::Level::Info);

            let tracing_logger = logger::tracing_impl::TracingLogger::init(&logs_dir, level)
                .map_err(|e| format!("failed to init logger: {e}"))?;

            let db_path = base.join("mongomacapp.sqlite");
            db::open(&db_path)
                .map_err(|e| format!("failed to open/migrate sqlite at {}: {}", db_path.display(), e))?;
            app.manage(AppState::new(
                db_path,
                logs_dir.clone(),
                tracing_logger.clone(),
            ));

            // Retention sweep: once at boot, then every 24h.
            let sweep_dir = logs_dir.clone();
            logger::retention::sweep(&sweep_dir, 7);
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(86_400));
                logger::retention::sweep(&sweep_dir, 7);
            });

            use crate::logger::{LogCtx, Logger as _};
            tracing_logger.info("app boot", LogCtx::new());

            // Pre-authorize keychain access early so macOS prompts the user
            // once at startup rather than on the first connection attempt.
            // Errors are logged but never block app startup.
            if let Err(e) = keychain::authorize_keychain_access(tracing_logger.as_ref()) {
                tracing_logger.warn("keychain pre-auth failed (non-fatal)", {
                    let mut ctx = LogCtx::new();
                    ctx.insert("err".into(), serde_json::json!(e));
                    ctx
                });
            }

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
            commands::logging::log_write,
            runner::executor::check_node_runner,
            runner::executor::install_node_runner,
            commands::ai::set_ai_token,
            commands::ai::get_ai_token,
            commands::ai::delete_ai_token,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}

fn dirs_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME environment variable is not set".to_string())?;
    Ok(PathBuf::from(home).join(".mongomacapp"))
}
