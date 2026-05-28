#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod connection;
mod db;
mod keychain;
mod logger;
mod mongo;
mod prefs;
mod runner;
mod ssh;
mod state;

use state::AppState;
use std::fs;
use std::path::PathBuf;
use tauri::menu::Menu;
use tauri::Manager;

fn main() {
    if let Err(e) = run() {
        eprintln!("Mongo Lens failed to start: {}", e);
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    // CONN_V2 toggles registration of the new tagged-union IPC commands.
    // Resolved once here so setup() and the invoke_handler branch agree
    // on the same value for the lifetime of the process.
    let conn_v2_enabled = std::env::var("CONN_V2").is_ok();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .menu(|handle| Menu::default(handle))
        .setup(move |app| {
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
                db_path.clone(),
                logs_dir.clone(),
                tracing_logger.clone(),
            ));

            // CONN_V2: opt-in dual-table mode. When the env var is set,
            // install the v2 secret store on AppState and run a one-shot
            // migrate_all over the legacy `connections` table so the v2
            // table starts in sync. Failures here log a warning and
            // continue — the legacy path is unaffected.
            if conn_v2_enabled {
                bootstrap_conn_v2(app, &db_path, tracing_logger.as_ref());
            }

            // Retention sweep: once at boot, then every 24h.
            let sweep_dir = logs_dir.clone();
            logger::retention::sweep(&sweep_dir, 7);
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(86_400));
                logger::retention::sweep(&sweep_dir, 7);
            });

            use crate::logger::{LogCtx, Logger as _};
            tracing_logger.info("app boot", LogCtx::new());

            Ok(())
        });

    // Existing v1 handlers stay registered unconditionally so the old
    // dialog keeps working. The v2 surface (connection_v2_* + prefs_*)
    // is appended only when CONN_V2 is enabled — generate_handler! is a
    // compile-time macro, so we pick one of two pre-built handler lists
    // at runtime here rather than mutating a single list.
    let builder = if conn_v2_enabled {
        builder.invoke_handler(tauri::generate_handler![
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
            commands::plugin_secrets::set_plugin_secret,
            commands::plugin_secrets::get_plugin_secret,
            commands::plugin_secrets::delete_plugin_secret,
            // CONN_V2 gated surface — see commands/connection_v2.rs and
            // commands/prefs.rs.
            commands::connection_v2::connections_v2_list,
            commands::connection_v2::connections_v2_save,
            commands::connection_v2::connections_v2_delete,
            commands::connection_v2::connections_v2_test,
            commands::prefs::prefs_get,
            commands::prefs::prefs_set,
            commands::prefs::prefs_resolve_effective,
        ])
    } else {
        builder.invoke_handler(tauri::generate_handler![
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
            commands::plugin_secrets::set_plugin_secret,
            commands::plugin_secrets::get_plugin_secret,
            commands::plugin_secrets::delete_plugin_secret,
        ])
    };

    builder
        .on_window_event(|window, event| {
            // On close: shut down all MongoDB pools (parallel, 1 s each), then all tunnels
            // (parallel, 2 s each). Parallel execution keeps total stall at max(1 s, 2 s)
            // regardless of connection count (C4). Ordering preserves pool-before-tunnel
            // invariant (shutdown pools first so no in-flight queries hit a dead tunnel).
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<AppState>();
                let clients: Vec<_> = state.mongo_clients.lock().unwrap().drain().collect();
                let tunnels: Vec<_> = state.ssh_tunnels.lock().unwrap().drain().collect();
                if !clients.is_empty() || !tunnels.is_empty() {
                    tauri::async_runtime::block_on(async move {
                        // All pools in parallel — total wait = max(1 s, slowest pool).
                        futures_util::future::join_all(clients.into_iter().map(|(_, c)| {
                            tokio::time::timeout(std::time::Duration::from_secs(1), c.shutdown())
                        }))
                        .await;
                        // All tunnels in parallel — total wait = max(2 s, slowest tunnel).
                        futures_util::future::join_all(
                            tunnels.into_iter().map(|(_, t)| t.close()),
                        )
                        .await;
                    });
                }
            }
        })
        .run(tauri::generate_context!())?;
    Ok(())
}

fn dirs_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME environment variable is not set".to_string())?;
    Ok(PathBuf::from(home).join(".mongomacapp"))
}

/// Open the v2 secret store, install it on AppState, and run a one-shot
/// `migrate_all` over the legacy `connections` table. Every step logs
/// independently and is independently recoverable: a Keychain failure
/// does not block migrate_all, and a per-row sync failure does not block
/// the next row.
fn bootstrap_conn_v2(
    app: &tauri::App,
    db_path: &std::path::Path,
    log: &logger::tracing_impl::TracingLogger,
) {
    use crate::logger::Logger as _;
    use std::sync::Arc;

    let store = match connection::secrets::open_default_keychain_store() {
        Ok(s) => Arc::new(s) as Arc<dyn connection::secrets::SecretStore>,
        Err(e) => {
            log.warn(
                "CONN_V2 secret store init failed; skipping bootstrap",
                logctx! { "phase" => "conn_v2_bootstrap", "err" => e.to_string() },
            );
            return;
        }
    };

    {
        let state = app.state::<AppState>();
        state.set_connection_secrets(store.clone());
    }

    let conn = match db::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            log.warn(
                "CONN_V2 db open failed; migrate_all skipped",
                logctx! { "phase" => "conn_v2_bootstrap", "err" => e.to_string() },
            );
            return;
        }
    };

    // Closure that bridges legacy keychain fetches into the migration
    // runner's `&dyn Fn(&str) -> Result<Option<String>, String>` API.
    let fetch_legacy_pw = |connection_id: &str| -> Result<Option<String>, String> {
        keychain::get_password(connection_id, log)
    };

    match connection::migration::migrate_all(&conn, &*store, &fetch_legacy_pw, log) {
        Ok(summary) => log.info(
            "CONN_V2 bootstrap migrate_all complete",
            logctx! {
                "total" => summary.total,
                "migrated" => summary.migrated,
                "skippedSecret" => summary.skipped_secret,
                "failed" => summary.failed,
            },
        ),
        Err(e) => log.warn(
            "CONN_V2 bootstrap migrate_all failed",
            logctx! { "phase" => "conn_v2_bootstrap", "err" => e.to_string() },
        ),
    }
}
