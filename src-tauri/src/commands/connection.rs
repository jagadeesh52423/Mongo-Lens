use crate::db::{self, connections::ConnectionRecord};
use crate::keychain;
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
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::connections::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    let id = uuid::Uuid::new_v4().to_string();
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
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::connections::insert(&conn, &rec).map_err(|e| e.to_string())?;
    if let Some(pw) = input.password {
        if !pw.is_empty() {
            keychain::set_password(&id, &pw)?;
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
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let existing = db::connections::get(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
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
    db::connections::update(&conn, &rec).map_err(|e| e.to_string())?;
    if let Some(pw) = input.password {
        if pw.is_empty() {
            keychain::delete_password(&id)?;
        } else {
            keychain::set_password(&id, &pw)?;
        }
    }
    Ok(rec)
}

#[tauri::command]
pub fn delete_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::connections::delete(&conn, &id).map_err(|e| e.to_string())?;
    keychain::delete_password(&id)?;
    let mut clients = state.mongo_clients.lock().unwrap();
    clients.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<TestResult, String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());
    match mongo::ping(&uri).await {
        Ok(()) => Ok(TestResult { ok: true, error: None }),
        Err(e) => Ok(TestResult { ok: false, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn connect_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());
    let client = mongo::client_for(&uri).await?;
    client
        .database("admin")
        .run_command(mongodb::bson::doc! {"ping": 1})
        .await
        .map_err(|e| e.to_string())?;
    state.mongo_clients.lock().unwrap().insert(id, client);
    Ok(())
}

#[tauri::command]
pub fn disconnect_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mongo_clients.lock().unwrap().remove(&id);
    Ok(())
}
