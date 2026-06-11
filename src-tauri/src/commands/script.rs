use crate::connection::store as connection_store;
use crate::logctx;
use crate::mongo;
use crate::runner::executor::spawn_script;
use crate::state::AppState;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, Ordering};
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
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log: Option<String>,
}

#[tauri::command]
pub fn cancel_script(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.script",
        "tabId" => tab_id.clone(),
    });
    log.info("cancel_script", logctx! {});
    let mut scripts = state.active_scripts.lock().unwrap();
    if let Some(flag) = scripts.remove(&tab_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
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
    run_id: Option<String>,
) -> Result<(), String> {
    let log = {
        let mut b = logctx! {
            "logger" => "commands.script",
            "connId" => connection_id.clone(),
            "tabId" => tab_id.clone(),
        };
        if let Some(r) = run_id.as_ref() {
            b.insert("runId".into(), serde_json::json!(r.clone()));
        }
        state.logger.child(b)
    };
    let page = page.unwrap_or(0);
    let page_size = page_size.unwrap_or(50);
    log.info("run_script start", logctx! {
        "db" => database.clone(),
        "page" => page,
        "pageSize" => page_size,
        "script" => script.clone(),          // redacted inside the logger
    });

    // Re-use the URI that the v2 connect path already validated and
    // stored. That URI has any SSH-tunnel rewrites and fallback params
    // (directConnection / tls) applied, so the Node runner connects with
    // the exact same string the Rust driver succeeded with — no extra
    // SDAM round-trip, no repeat of the legacy 30s fallback.
    //
    // If `active_uri` is None, the connection was never connected (or was
    // disconnected behind our back). The dialog requires Connect before
    // Run; reaching this path means the UI is out of sync. Error
    // explicitly rather than re-deriving a URI from scratch — the prior
    // re-derive path leaked legacy `ConnectionRecord` shape into the v2
    // world and silently used stale keychain creds.
    let uri = mongo::active_uri(&state, &connection_id).ok_or_else(|| {
        log.error("connection not established (no active URI)", logctx! {});
        "connection not established — connect first".to_string()
    })?;

    // Fetch the runner credential (if any) for this connection. Only present
    // for password-based auth modes; None for X509 / no-auth / URI-embedded
    // creds. Intentionally not logged — password must stay out of log output.
    let cred = mongo::active_runner_cred(&state, &connection_id);

    // For diagnostics only — derive a one-line "where" string from the v2
    // model. Failure to look up the connection here is non-fatal (we have
    // a working URI already); just emit a tag-free debug log.
    if let Ok(conn) = state.open_db() {
        if let Ok(Some(c)) = connection_store::get(&conn, &connection_id) {
            log.debug(
                "resolved connection",
                logctx! { "name" => c.name.clone(), "target" => host_tag(&c.target) },
            );
        }
    }

    // Write the query to a 0600 temp file inside the app data dir (~/.mongomacapp)
    // rather than world-readable /tmp. NamedTempFile deletes on drop, so the
    // plaintext query never outlives the command — even on panic/timeout/cancel.
    // The `tmp_script` guard is held in this outer scope until the child exits.
    let app_data_dir = state
        .db_path
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    let tmp_script = write_temp_script(&app_data_dir, &script).map_err(|e| {
        log.error("write tmp script failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let script_path = tmp_script.path().to_path_buf();
    log.debug("script written", logctx! { "path" => script_path.display().to_string() });

    let run_id_str = run_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let tab_id_arc: Arc<String> = Arc::new(tab_id.clone());
    let run_id_arc: Arc<Option<String>> = Arc::new(Some(run_id_str.clone()));
    let app_handle = app.clone();
    let start = Instant::now();

    // Cancel any previously running script on this tab, then register the new flag.
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut scripts = state.active_scripts.lock().unwrap();
        if let Some(old_flag) = scripts.remove(&*tab_id_arc) {
            old_flag.store(true, Ordering::Relaxed);
        }
        scripts.insert((*tab_id_arc).clone(), cancel_flag.clone());
    }

    let level = std::env::var("MONGOMACAPP_LOG_LEVEL").unwrap_or_else(|_| "info".into());

    // Body wrapped so the cancel-flag cleanup below always runs, even when
    // spawn_script or the stdout/stderr taps fail with `?`. The temp script
    // file is cleaned up by the `tmp_script` RAII guard on scope exit.
    let result: Result<(), String> = async {
        let mut child = spawn_script(
            &uri,
            &database,
            &script_path,
            page,
            page_size,
            &run_id_str,
            &state.logs_dir,
            &level,
            state.logger.clone(),
            cred.as_ref(),
        )?;
        log.info("child spawned", logctx! { "pid" => child.id() });
        let stdout = child.stdout.take().ok_or_else(|| {
            log.error("no stdout", logctx! {});
            "no stdout".to_string()
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            log.error("no stderr", logctx! {});
            "no stderr".to_string()
        })?;

        let stdout_handle = {
            let ah = app_handle.clone();
            let tab = tab_id_arc.clone();
            let rid = run_id_arc.clone();
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
                                    run_id: (*rid).clone(),
                                    collection: None,
                                    category: None,
                                    log: None,
                                };
                                let _ = ah.emit("script-event", evt);
                            }
                        } else if let Some(message) = v
                            .get("__log")
                            .and_then(|x| x.get("message"))
                            .and_then(|x| x.as_str())
                        {
                            let evt = ScriptEvent {
                                tab_id: (*tab).clone(),
                                kind: "log".into(),
                                group_index: None,
                                docs: None,
                                error: None,
                                execution_ms: None,
                                pagination: None,
                                run_id: (*rid).clone(),
                                collection: None,
                                category: None,
                                log: Some(message.to_string()),
                            };
                            let _ = ah.emit("script-event", evt);
                        } else if let (Some(idx), Some(docs)) = (
                            v.get("__group").and_then(|x| x.as_i64()),
                            v.get("docs"),
                        ) {
                            let collection = v
                                .get("collection")
                                .and_then(|x| x.as_str())
                                .map(|s| s.to_string());
                            let category = v
                                .get("category")
                                .and_then(|x| x.as_str())
                                .map(|s| s.to_string());
                            let evt = ScriptEvent {
                                tab_id: (*tab).clone(),
                                kind: "group".into(),
                                group_index: Some(idx),
                                docs: Some(docs.clone()),
                                error: None,
                                execution_ms: None,
                                pagination: None,
                                run_id: (*rid).clone(),
                                collection,
                                category,
                                log: None,
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
            let rid = run_id_arc.clone();
            let err_log = log.child(logctx! {});
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    let parsed = serde_json::from_str::<serde_json::Value>(&line).ok();
                    // __debug lines are diagnostic only — log to backend.log, not UI
                    if let Some(msg) = parsed.as_ref().and_then(|v| v.get("__debug")).and_then(|v| v.as_str()) {
                        err_log.debug(msg, logctx! {});
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
                        run_id: (*rid).clone(),
                        collection: None,
                        category: None,
                        log: None,
                    };
                    let _ = ah.emit("script-event", evt);
                }
            })
        };

        let wait_result = timeout(Duration::from_secs(SCRIPT_TIMEOUT_SECS), async {
            loop {
                if cancel_flag.load(Ordering::Relaxed) {
                    // SIGTERM + grace before SIGKILL so the harness can close its
                    // Mongo connection; terminate_child reaps the child itself.
                    crate::runner::executor::terminate_child(&mut child);
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Interrupted,
                        "cancelled",
                    ));
                }
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
                let elapsed = start.elapsed().as_millis();
                log.info("run_script done", logctx! {
                    "ok" => status.success(),
                    "elapsedMs" => elapsed.to_string(),
                });
                let done = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "done".into(),
                    group_index: None,
                    docs: None,
                    error: if status.success() { None } else { Some("exited with error".into()) },
                    execution_ms: Some(elapsed),
                    pagination: None,
                    run_id: (*run_id_arc).clone(),
                    collection: None,
                    category: None,
                    log: None,
                };
                let _ = app_handle.emit("script-event", done);
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                if e.kind() == std::io::ErrorKind::Interrupted {
                    log.info("run_script cancelled", logctx! {});
                    // Intentional cancel — frontend handles via handleCancel.
                    Ok(())
                } else {
                    log.error("wait failed", logctx! { "err" => e.to_string() });
                    Err(e.to_string())
                }
            }
            Err(_) => {
                // SIGTERM + grace before SIGKILL (lets the harness close its Mongo
                // connection), reaping the child so its stdout/stderr pipes flush EOF
                // before we join the readers. terminate_child does the reap.
                crate::runner::executor::terminate_child(&mut child);
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                log.warn("run_script timed out", logctx! {
                    "timeoutSecs" => SCRIPT_TIMEOUT_SECS,
                });
                let evt = ScriptEvent {
                    tab_id: (*tab_id_arc).clone(),
                    kind: "error".into(),
                    group_index: None,
                    docs: None,
                    error: Some(format!("Script execution timed out ({SCRIPT_TIMEOUT_SECS}s)")),
                    execution_ms: None,
                    pagination: None,
                    run_id: (*run_id_arc).clone(),
                    collection: None,
                    category: None,
                    log: None,
                };
                let _ = app_handle.emit("script-event", evt);
                Ok(())
            }
        }
    }
    .await;

    // Only remove our flag — a newer run may have already replaced it.
    {
        let mut scripts = state.active_scripts.lock().unwrap();
        if let Some(current) = scripts.get(&*tab_id_arc) {
            if Arc::ptr_eq(current, &cancel_flag) {
                scripts.remove(&*tab_id_arc);
            }
        }
    }

    // `tmp_script` (the NamedTempFile guard) drops here, deleting the file.
    drop(tmp_script);
    result
}

/// Write `contents` to a fresh 0600 temp file in `dir` (tempfile's unix default).
/// The returned guard deletes the file on drop — keep it alive while the path is in use.
fn write_temp_script(
    dir: &std::path::Path,
    contents: &str,
) -> std::io::Result<tempfile::NamedTempFile> {
    let mut file = tempfile::Builder::new()
        .prefix("mongomacapp-script-")
        .suffix(".js")
        .tempfile_in(dir)?;
    file.write_all(contents.as_bytes())?;
    file.flush()?;
    Ok(file)
}

/// Compact "where" tag for a v2 `ConnectionTarget`, used only in debug
/// logs (`resolved connection`) so a glance at the log line tells you
/// host:port or "uri". Not load-bearing — never parsed back.
fn host_tag(target: &crate::connection::model::ConnectionTarget) -> String {
    use crate::connection::model::ConnectionTarget;
    match target {
        ConnectionTarget::Direct { host, port, .. } => format!("{host}:{port}"),
        ConnectionTarget::Uri { .. } => "uri".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::write_temp_script;
    use std::io::Read;

    #[test]
    fn temp_script_holds_contents_and_deletes_on_drop() {
        let dir = std::env::temp_dir();
        let path;
        {
            let guard = write_temp_script(&dir, "db.users.find({})").expect("create temp script");
            path = guard.path().to_path_buf();
            assert!(path.starts_with(&dir), "temp file must live in the requested dir");

            let mut contents = String::new();
            std::fs::File::open(&path)
                .expect("reopen temp script by path")
                .read_to_string(&mut contents)
                .expect("read temp script");
            assert_eq!(contents, "db.users.find({})");

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
                assert_eq!(mode, 0o600, "temp script must be owner-only (0600)");
            }
        }
        assert!(!path.exists(), "temp script must be deleted when the guard drops");
    }
}
