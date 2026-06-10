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
use state::LockRecovered;
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

            // V2 is the canonical surface now. Install the v2 secret
            // store on AppState and run a one-shot migrate_all over the
            // legacy table so any pre-PR-5 user's rows make it into v2.
            // Failures log a warning and continue — fresh installs have
            // nothing to migrate, and an empty sweep is a no-op.
            bootstrap_conn_v2(app, &db_path, tracing_logger.as_ref());

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

    // Single canonical handler list. The legacy connection_* commands
    // were deleted in PR 5; the v2 connections_v2_* surface is the only
    // path now (Task 20 will rename it back to `connections` once the
    // table rename lands).
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::connection_v2::connections_v2_list,
        commands::connection_v2::connections_v2_save,
        commands::connection_v2::connections_v2_delete,
        commands::connection_v2::connections_v2_test,
        commands::connection_v2::connections_v2_connect,
        commands::connection_v2::connections_v2_disconnect,
        commands::prefs::prefs_get,
        commands::prefs::prefs_set,
        commands::prefs::prefs_resolve_effective,
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
        commands::saved_script::rename_tag,
        commands::saved_script::delete_tag,
        commands::logging::log_write,
        runner::executor::check_node_runner,
        runner::executor::install_node_runner,
        commands::ai::set_ai_token,
        commands::ai::get_ai_token,
        commands::ai::delete_ai_token,
        commands::plugin_secrets::set_plugin_secret,
        commands::plugin_secrets::get_plugin_secret,
        commands::plugin_secrets::delete_plugin_secret,
    ]);

    builder
        .on_window_event(|window, event| {
            // On close: shut down all MongoDB pools (parallel, 1 s each), then all tunnels
            // (parallel, 2 s each). Ordering preserves the pool-before-tunnel invariant (shut
            // pools first so no in-flight query hits a dead tunnel). The teardown runs OFF the
            // UI thread — we hide the window for an instant-feeling close, drain the maps
            // synchronously (cheap), then spawn the awaits and exit once they finish, with a
            // watchdog that force-exits within ~3 s. This replaces a block_on that froze the
            // window for up to ~2 s.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let clients: Vec<_> = state.mongo_clients.lock_recovered().drain().collect();
                let tunnels: Vec<_> = state.ssh_tunnels.lock_recovered().drain().collect();
                if clients.is_empty() && tunnels.is_empty() {
                    return; // nothing to tear down — let the window close immediately
                }
                api.prevent_close();
                let _ = window.hide();
                let app = window.app_handle().clone();

                // Hard guarantee: exit within ~3 s no matter what. This backstops a
                // cleanup task that hangs or panics before reaching app.exit, so we
                // never leave a hidden-window zombie process behind.
                let watchdog = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    watchdog.exit(0);
                });

                tauri::async_runtime::spawn(async move {
                    // Pools first (so no in-flight query hits a dead tunnel), each bounded.
                    futures_util::future::join_all(clients.into_iter().map(|(_, c)| {
                        tokio::time::timeout(std::time::Duration::from_secs(1), c.shutdown())
                    }))
                    .await;
                    // Tunnels next, each bounded so a stuck close() can't hang shutdown.
                    futures_util::future::join_all(tunnels.into_iter().map(|(_, t)| {
                        tokio::time::timeout(std::time::Duration::from_secs(2), t.close())
                    }))
                    .await;
                    app.exit(0);
                });
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
/// the next row. Always called now that v2 is the canonical surface
/// (the prior `CONN_V2` env gate was removed in PR 5).
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
                "v2 secret store init failed; skipping bootstrap",
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
                "v2 db open failed; migrate_all skipped",
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
            "v2 bootstrap migrate_all complete",
            logctx! {
                "total" => summary.total,
                "migrated" => summary.migrated,
                "skippedSecret" => summary.skipped_secret,
                "failed" => summary.failed,
            },
        ),
        Err(e) => log.warn(
            "v2 bootstrap migrate_all failed",
            logctx! { "phase" => "conn_v2_bootstrap", "err" => e.to_string() },
        ),
    }
}
