use crate::db;
use crate::keychain;
use crate::mongo;
use crate::runner::executor::spawn_script;
use crate::state::AppState;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{timeout, Duration};

const SCRIPT_TIMEOUT_SECS: u64 = 30;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaginationInfo {
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEvent {
    pub tab_id: String,
    pub kind: String,
    pub group_index: Option<i64>,
    pub docs: Option<serde_json::Value>,
    pub error: Option<String>,
    pub execution_ms: Option<u128>,
    pub pagination: Option<PaginationInfo>,
}

#[tauri::command]
pub async fn run_script(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    connection_id: String,
    database: String,
    script: String,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<(), String> {
    println!("[run_script] tab={tab_id} connection_id={connection_id} db={database}");
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&connection_id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());
    println!("[run_script] uri host={:?} db={database}", rec.host);

    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join(format!("mongomacapp-{}.js", uuid::Uuid::new_v4()));
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;
    println!("[run_script] script written to {:?}", script_path);

    let tab_id_arc: Arc<String> = Arc::new(tab_id);
    let app_handle = app.clone();
    let start = Instant::now();

    let page = page.unwrap_or(0);
    let page_size = page_size.unwrap_or(50);

    // Wrap the body so the temp script file is always cleaned up,
    // even if spawn_script or stdout/stderr take fail with `?`.
    let result: Result<(), String> = async {
        let mut child = spawn_script(&uri, &database, &script_path, page, page_size)?;
        println!("[run_script] child spawned pid={:?}", child.id());
        let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

        let stdout_handle = {
            let ah = app_handle.clone();
            let tab = tab_id_arc.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(pg) = v.get("__pagination") {
                            if let (Some(total), Some(page_val), Some(page_size_val)) = (
                                pg.get("total").and_then(|x| x.as_i64()),
                                pg.get("page").and_then(|x| x.as_u64()),
                                pg.get("pageSize").and_then(|x| x.as_u64()),
                            ) {
                                let evt = ScriptEvent {
                                    tab_id: (*tab).clone(),
                                    kind: "pagination".into(),
                                    group_index: None,
                                    docs: None,
                                    error: None,
                                    execution_ms: None,
                                    pagination: Some(PaginationInfo {
                                        total,
                                        page: page_val as u32,
                                        page_size: page_size_val as u32,
                                    }),
                                };
                                let _ = ah.emit("script-event", evt);
                            }
                        } else if let (Some(idx), Some(docs)) = (
                            v.get("__group").and_then(|x| x.as_i64()),
                            v.get("docs"),
                        ) {
                            let evt = ScriptEvent {
                                tab_id: (*tab).clone(),
                                kind: "group".into(),
                                group_index: Some(idx),
                                docs: Some(docs.clone()),
                                error: None,
                                execution_ms: None,
                                pagination: None,
                            };
                            let _ = ah.emit("script-event", evt);
                        }
                    }
                }
            })
        };

        let stderr_handle = {
            let ah = app_handle.clone();
            let tab = tab_id_arc.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    let parsed = serde_json::from_str::<serde_json::Value>(&line).ok();
                    // __debug lines are diagnostic only — log to terminal, not UI
                    if let Some(msg) = parsed.as_ref().and_then(|v| v.get("__debug")).and_then(|v| v.as_str()) {
                        println!("{msg}");
                        continue;
                    }
                    let err = parsed
                        .and_then(|v| v.get("__error").and_then(|e| e.as_str()).map(|s| s.to_string()))
                        .unwrap_or(line);
                    let evt = ScriptEvent {
                        tab_id: (*tab).clone(),
                        kind: "error".into(),
                        group_index: None,
                        docs: None,
                        error: Some(err),
                        execution_ms: None,
                        pagination: None,
                    };
                    let _ = ah.emit("script-event", evt);
                }
            })
        };

        let wait_result = timeout(Duration::from_secs(SCRIPT_TIMEOUT_SECS), async {
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => return Ok(status),
                    Ok(None) => tokio::time::sleep(Duration::from_millis(50)).await,
                    Err(e) => return Err(e),
                }
            }
        })
        .await;

        match wait_result {
            Ok(Ok(status)) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                println!("[run_script] done, exit_success={}", status.success());
                let elapsed = start.elapsed().as_millis();
                let done = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "done".into(),
                    group_index: None,
                    docs: None,
                    error: if status.success() { None } else { Some("exited with error".into()) },
                    execution_ms: Some(elapsed),
                    pagination: None,
                };
                let _ = app_handle.emit("script-event", done);
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                println!("[run_script] wait failed: {e}");
                Err(e.to_string())
            }
            Err(_) => {
                // Kill, then reap so we don't leave a zombie and so the
                // stdout/stderr pipes flush EOF before we join the readers.
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                println!("[run_script] timed out after {SCRIPT_TIMEOUT_SECS}s, killed child");
                let evt = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "error".into(),
                    group_index: None,
                    docs: None,
                    error: Some(format!("Script execution timed out ({SCRIPT_TIMEOUT_SECS}s)")),
                    execution_ms: None,
                    pagination: None,
                };
                let _ = app_handle.emit("script-event", evt);
                Ok(())
            }
        }
    }
    .await;

    let _ = std::fs::remove_file(&script_path);
    result
}
