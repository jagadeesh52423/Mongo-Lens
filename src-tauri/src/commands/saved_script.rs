use crate::db::{self, scripts::SavedScriptRecord};
use crate::logctx;
use crate::state::AppState;
use tauri::State;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn list_scripts(state: State<'_, AppState>) -> Result<Vec<SavedScriptRecord>, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.saved_script" });
    log.info("list_scripts", logctx! {});
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    db::scripts::list(&conn).map_err(|e| {
        log.error("list failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
}

#[tauri::command]
pub fn create_script(
    state: State<'_, AppState>,
    name: String,
    content: String,
    tags: Vec<String>,
    connection_id: Option<String>,
) -> Result<SavedScriptRecord, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.saved_script" });
    log.info("create_script", logctx! { "name" => name.clone() });
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let rec = SavedScriptRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        content,
        tags,
        connection_id,
        last_run_at: None,
        created_at: now_iso(),
    };
    db::scripts::insert(&conn, &rec).map_err(|e| {
        log.error("insert failed", logctx! { "scriptId" => rec.id.clone(), "err" => e.to_string() });
        e.to_string()
    })?;
    Ok(rec)
}

#[tauri::command]
pub fn update_script(
    state: State<'_, AppState>,
    id: String,
    name: String,
    content: String,
    tags: Vec<String>,
    connection_id: Option<String>,
) -> Result<SavedScriptRecord, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.saved_script",
        "scriptId" => id.clone(),
    });
    log.info("update_script", logctx! { "name" => name.clone() });
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let existing = db::scripts::get(&conn, &id)
        .map_err(|e| {
            log.error("get failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?
        .ok_or_else(|| {
            log.error("script not found", logctx! {});
            "script not found".to_string()
        })?;
    let rec = SavedScriptRecord {
        id,
        name,
        content,
        tags,
        connection_id,
        last_run_at: existing.last_run_at,
        created_at: existing.created_at,
    };
    db::scripts::update(&conn, &rec).map_err(|e| {
        log.error("update failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    Ok(rec)
}

#[tauri::command]
pub fn delete_script(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.saved_script",
        "scriptId" => id.clone(),
    });
    log.info("delete_script", logctx! {});
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    db::scripts::delete(&conn, &id).map_err(|e| {
        log.error("delete failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
}

#[tauri::command]
pub fn touch_script(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.saved_script",
        "scriptId" => id.clone(),
    });
    log.debug("touch_script", logctx! {});
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    db::scripts::touch(&conn, &id, &now_iso()).map_err(|e| {
        log.error("touch failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
}
