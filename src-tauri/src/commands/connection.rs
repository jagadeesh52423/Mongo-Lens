use crate::db::{self, connections::ConnectionRecord};
use crate::keychain;
use crate::logctx;
use crate::logger::Logger;
use crate::mongo;
use crate::mongo::connect::{connect, ConnectOutcome};
use crate::ssh::auth::AuthSecrets;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub name: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub auth_db: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub conn_string: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_key_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub error: Option<String>,
}

/// Returned by `connect_connection` to let the frontend decide whether to
/// show a passphrase dialog, a host-key confirmation dialog, or nothing.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectResult {
    /// MongoDB client established; connection is live.
    Connected,
    /// SSH key is encrypted. Retry `connect_connection` with `passphrase` set.
    PassphraseRequired { connection_id: String },
    /// SSH host key unknown. Show fingerprint to user; retry with `acceptHostKey: true`.
    HostKeyUnknown {
        connection_id: String,
        fingerprint: String,
        algorithm: String,
        host: String,
        port: u16,
    },
}

/// Payload for the `ssh_session_lost` Tauri event emitted when an SSH tunnel drops.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionLostPayload {
    pub connection_id: String,
}

/// Monitors a tunnel's liveness watch channel. When it transitions to dead:
/// 1. Removes the connection from all AppState maps (client, uri, tunnel).
/// 2. Emits `ssh_session_lost` so the UI can flip to disconnected.
///
/// This runs concurrently with explicit `disconnect_connection` — both paths check
/// for entry presence before removing, so they're idempotent.
///
/// State is accessed through `app_handle.state()` to avoid lifetime issues with
/// `tauri::State` inside spawned tasks.
async fn handle_session_loss(
    mut alive_rx: tokio::sync::watch::Receiver<bool>,
    connection_id: String,
    app_handle: AppHandle,
    log: Arc<dyn Logger>,
) {
    // Wait until the watch transitions (session dropped) or the sender is dropped (tunnel closed).
    loop {
        match alive_rx.changed().await {
            Err(_) => break, // sender dropped — tunnel was explicitly closed, nothing to do
            Ok(()) => {
                if !*alive_rx.borrow() {
                    break; // session went dead
                }
                // spurious true→true transition: stay in loop
            }
        }
    }

    // If the watch still reads true, the sender was dropped cleanly (explicit close) — not a crash.
    if *alive_rx.borrow() {
        return;
    }

    log.warn(
        "ssh session lost",
        logctx! { "connId" => connection_id.clone() },
    );

    // Access AppState through the app handle (safe from any async context).
    let state: State<'_, AppState> = app_handle.state();

    // Clean up state — same as disconnect_connection, but triggered by session drop.
    let client: Option<mongodb::Client> = state.mongo_clients.lock().unwrap().remove(&connection_id);
    state.mongo_uris.lock().unwrap().remove(&connection_id);
    let tunnel: Option<crate::ssh::TunnelHandle> = state.ssh_tunnels.lock().unwrap().remove(&connection_id);

    if let Some(c) = client {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), c.shutdown()).await;
    }
    if let Some(t) = tunnel {
        t.close().await;
    }

    // Notify the frontend.
    let _ = app_handle.emit("ssh_session_lost", SshSessionLostPayload {
        connection_id,
    });
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionRecord>, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.connection" });
    log.info("list_connections", logctx! {});
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    db::connections::list(&conn).map_err(|e| {
        log.error("list failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
}

#[tauri::command]
pub fn create_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.connection" });
    let id = uuid::Uuid::new_v4().to_string();
    log.info("create_connection", logctx! {
        "connId" => id.clone(),
        "name" => input.name.clone(),
    });
    let rec = ConnectionRecord {
        id: id.clone(),
        name: input.name,
        host: input.host,
        port: input.port,
        auth_db: input.auth_db,
        username: input.username,
        conn_string: input.conn_string,
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user,
        ssh_key_path: input.ssh_key_path,
        created_at: now_iso(),
    };
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    db::connections::insert(&conn, &rec).map_err(|e| {
        log.error("insert failed", logctx! { "connId" => id.clone(), "err" => e.to_string() });
        e.to_string()
    })?;
    if let Some(pw) = input.password {
        if !pw.is_empty() {
            keychain::set_password(&id, &pw, log.as_ref())?;
        }
    }
    Ok(rec)
}

#[tauri::command]
pub fn update_connection(
    state: State<'_, AppState>,
    id: String,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection",
        "connId" => id.clone(),
    });
    log.info("update_connection", logctx! { "name" => input.name.clone() });
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let existing = db::connections::get(&conn, &id)
        .map_err(|e| {
            log.error("get failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?
        .ok_or_else(|| {
            log.error("connection not found", logctx! {});
            "connection not found".to_string()
        })?;
    let rec = ConnectionRecord {
        id: id.clone(),
        name: input.name,
        host: input.host,
        port: input.port,
        auth_db: input.auth_db,
        username: input.username,
        conn_string: input.conn_string,
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user,
        ssh_key_path: input.ssh_key_path,
        created_at: existing.created_at,
    };
    db::connections::update(&conn, &rec).map_err(|e| {
        log.error("update failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    if let Some(pw) = input.password {
        if pw.is_empty() {
            keychain::delete_password(&id, log.as_ref())?;
        } else {
            keychain::set_password(&id, &pw, log.as_ref())?;
        }
    }
    Ok(rec)
}

/// Delete a connection record. Shuts down any live MongoDB client and SSH tunnel
/// before removing the DB row, ensuring no leaked resources (S5).
#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection",
        "connId" => id.clone(),
    });
    log.info("delete_connection", logctx! {});

    // Drain client + tunnel first (I-2: pool before tunnel).
    let client = state.mongo_clients.lock().unwrap().remove(&id);
    state.mongo_uris.lock().unwrap().remove(&id);
    let tunnel = state.ssh_tunnels.lock().unwrap().remove(&id);

    if let Some(c) = client {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), c.shutdown()).await;
    }
    if let Some(t) = tunnel {
        t.close().await;
        log.info("ssh tunnel closed (delete)", logctx! {});
    }

    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    db::connections::delete(&conn, &id).map_err(|e| {
        log.error("delete failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    keychain::delete_password(&id, log.as_ref())?;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<TestResult, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection",
        "connId" => id.clone(),
    });
    log.info("test_connection", logctx! {});
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let rec = db::connections::get(&conn, &id)
        .map_err(|e| {
            log.error("get failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?
        .ok_or_else(|| {
            log.error("connection not found", logctx! {});
            "connection not found".to_string()
        })?;
    drop(conn);
    let pw = keychain::get_password(&id, log.as_ref())?;
    let uri = mongo::build_uri(&rec, pw.as_deref());
    match mongo::ping(&uri, log.as_ref()).await {
        Ok(()) => {
            log.info("test_connection ok", logctx! {});
            Ok(TestResult { ok: true, error: None })
        }
        Err(e) => {
            log.warn("test_connection failed", logctx! { "err" => e.clone() });
            Ok(TestResult { ok: false, error: Some(e) })
        }
    }
}

/// Connect to a MongoDB instance, optionally through an SSH tunnel.
///
/// Returns a `ConnectResult` that the frontend pattern-matches to decide whether
/// to open a passphrase dialog (`PassphraseRequired`) or a host-key confirmation
/// dialog (`HostKeyUnknown`) before retrying.
///
/// Parameters:
/// - `id`: connection record ID
/// - `passphrase`: SSH key passphrase (supply on retry after `PassphraseRequired`)
/// - `accept_host_key`: pass `true` after the user accepted the fingerprint in the UI
#[tauri::command]
pub async fn connect_connection(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    id: String,
    passphrase: Option<String>,
    accept_host_key: Option<bool>,
) -> Result<ConnectResult, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection",
        "connId" => id.clone(),
    });
    log.info("connect_connection", logctx! {});

    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let rec = db::connections::get(&conn, &id)
        .map_err(|e| {
            log.error("get failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?
        .ok_or_else(|| {
            log.error("connection not found", logctx! {});
            "connection not found".to_string()
        })?;
    drop(conn);

    let pw = keychain::get_password(&id, log.as_ref())?;
    let log_arc: Arc<dyn crate::logger::Logger> = log.clone();

    // Build AuthSecrets at the IPC boundary — wraps passphrase in Zeroizing so heap is
    // wiped on drop. Future auth variants (password, agent) extend AuthSecrets, not this site.
    let secrets = AuthSecrets::new(passphrase);

    let outcome = connect(
        &rec,
        pw.as_deref(),
        secrets,
        accept_host_key.unwrap_or(false),
        log_arc,
    )
    .await?;

    match outcome {
        ConnectOutcome::Connected {
            client,
            winning_uri,
            tunnel,
        } => {
            // Close any previously open tunnel for this connection before replacing.
            let old_tunnel = state.ssh_tunnels.lock().unwrap().remove(&id);
            if let Some(old) = old_tunnel {
                old.close().await;
            }

            state.mongo_clients.lock().unwrap().insert(id.clone(), client);
            state.mongo_uris.lock().unwrap().insert(id.clone(), winning_uri);

            if let Some(t) = tunnel {
                // Spawn the session-loss monitor before inserting the handle into state.
                // The monitor holds its own watch::Receiver clone; changing the receiver
                // requires &mut self so each waiter holds its own (N-8).
                let alive_rx = t.alive_watch();
                let monitor_log = log.clone();
                let monitor_id = id.clone();
                let monitor_handle = app_handle.clone();
                tokio::spawn(async move {
                    handle_session_loss(alive_rx, monitor_id, monitor_handle, monitor_log).await;
                });

                state.ssh_tunnels.lock().unwrap().insert(id.clone(), t);
            }
            log.info("connect_connection ok", logctx! {});
            Ok(ConnectResult::Connected)
        }
        ConnectOutcome::PassphraseRequired { connection_id } => {
            log.info("connect_connection: passphrase required", logctx! {});
            Ok(ConnectResult::PassphraseRequired { connection_id })
        }
        ConnectOutcome::HostKeyUnknown {
            connection_id,
            fingerprint,
            algorithm,
            host,
            port,
        } => {
            log.info(
                "connect_connection: host key unknown",
                logctx! { "host" => host.clone(), "alg" => algorithm.clone() },
            );
            Ok(ConnectResult::HostKeyUnknown {
                connection_id,
                fingerprint,
                algorithm,
                host,
                port,
            })
        }
    }
}

#[tauri::command]
pub async fn disconnect_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection",
        "connId" => id.clone(),
    });
    log.info("disconnect_connection", logctx! {});

    // Remove the MongoDB client first (I-2: shutdown pool before closing tunnel).
    let client = state.mongo_clients.lock().unwrap().remove(&id);
    state.mongo_uris.lock().unwrap().remove(&id);

    // Gracefully shut down the pool so pooled connections close before the tunnel drops.
    if let Some(c) = client {
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            c.shutdown(),
        )
        .await;
    }

    // Now close the SSH tunnel (safe since the pool is drained).
    let tunnel = state.ssh_tunnels.lock().unwrap().remove(&id);
    if let Some(t) = tunnel {
        t.close().await;
        log.info("ssh tunnel closed", logctx! {});
    }

    Ok(())
}
