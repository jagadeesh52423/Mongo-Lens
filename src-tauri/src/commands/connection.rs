use crate::db::{self, connections::ConnectionRecord};
use crate::keychain;
use crate::logctx;
use crate::mongo;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

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

#[tauri::command]
pub fn delete_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection",
        "connId" => id.clone(),
    });
    log.info("delete_connection", logctx! {});
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    db::connections::delete(&conn, &id).map_err(|e| {
        log.error("delete failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    keychain::delete_password(&id, log.as_ref())?;
    state.mongo_clients.lock().unwrap().remove(&id);
    state.mongo_uris.lock().unwrap().remove(&id);
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

#[tauri::command]
pub async fn connect_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
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
    let uri = mongo::build_uri(&rec, pw.as_deref());
    let (client, winning_uri) = mongo::client_for(&uri, log.as_ref()).await?;
    state.mongo_clients.lock().unwrap().insert(id.clone(), client);
    state.mongo_uris.lock().unwrap().insert(id, winning_uri);
    log.info("connect_connection ok", logctx! {});
    Ok(())
}

#[tauri::command]
pub fn disconnect_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection",
        "connId" => id.clone(),
    });
    log.info("disconnect_connection", logctx! {});
    state.mongo_clients.lock().unwrap().remove(&id);
    state.mongo_uris.lock().unwrap().remove(&id);
    Ok(())
}
