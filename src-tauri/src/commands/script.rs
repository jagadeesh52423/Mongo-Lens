use crate::connection::store as connection_store;
use crate::logctx;
use crate::mongo;
use crate::runner::HarnessHandle;
use crate::state::{ActiveRun, AppState};
use serde::Serialize;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

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

/// Cancel the in-flight run on `tab_id`. With the persistent harness this sends
/// a `cancel` frame to the connection's harness (which stops the run and emits
/// a terminal `__done`) instead of killing a process — the harness and its
/// Mongo connection are reused across queries.
#[tauri::command]
pub fn cancel_script(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.script",
        "tabId" => tab_id.clone(),
    });
    log.info("cancel_script", logctx! {});

    let active = state.active_scripts.lock().unwrap().get(&tab_id).cloned();
    let Some(active) = active else {
        // No in-flight run for this tab — nothing to cancel.
        return Ok(());
    };
    if let Some(handle) = mongo::active_harness(&state, &active.connection_id) {
        if let Err(e) = handle.send_cancel(&active.request_id) {
            log.warn("cancel_script: send_cancel failed", logctx! { "err" => e });
        }
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

    // Get the connection's persistent harness, respawning lazily if it crashed
    // or was never spawned. `ensure_harness` errors when the connection isn't
    // active (no cached URI) — the dialog requires Connect before Run, so that
    // means the UI is out of sync; surface it explicitly.
    let harness = mongo::ensure_harness(&state, &connection_id, &database, state.logger.clone())
        .await
        .map_err(|e| {
            log.error("harness unavailable", logctx! { "err" => e.clone() });
            e
        })?;

    // For diagnostics only — derive a one-line "where" string from the v2
    // model. Failure to look up the connection here is non-fatal.
    if let Ok(conn) = state.open_db() {
        if let Ok(Some(c)) = connection_store::get(&conn, &connection_id) {
            log.debug(
                "resolved connection",
                logctx! { "name" => c.name.clone(), "target" => host_tag(&c.target) },
            );
        }
    }

    // tabId is the cancel correlation key; the request id is unique per run so
    // a stale response from a prior run on the same tab can't collide in the
    // harness demux map. If a previous run on this tab is still in flight, tell
    // the harness to cancel it before starting the new one (the harness runs
    // requests serially, so a lingering prior run would otherwise block ours).
    let req_id = uuid::Uuid::new_v4().to_string();
    {
        let prior = state.active_scripts.lock().unwrap().insert(
            tab_id.clone(),
            ActiveRun {
                connection_id: connection_id.clone(),
                request_id: req_id.clone(),
            },
        );
        if let Some(prior) = prior {
            let _ = harness.send_cancel(&prior.request_id);
        }
    }

    let run_id_str = run_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let start = Instant::now();

    // Send the run request and stream responses on a blocking thread (the
    // harness response channel is a std mpsc, drained synchronously). The
    // closure owns everything it needs and emits `script-event`s in the exact
    // shape the per-child model produced, so the frontend is unchanged.
    let outcome = {
        let app_handle = app.clone();
        let tab = tab_id.clone();
        let run_id_for_thread = run_id_str.clone();
        let harness_for_thread = harness.clone();
        let req_for_thread = req_id.clone();
        let db = database.clone();
        let script = script.clone();
        let stream_log = log.child(logctx! {});
        tokio::task::spawn_blocking(move || {
            stream_run(
                &harness_for_thread,
                &req_for_thread,
                &db,
                &script,
                page,
                page_size,
                &app_handle,
                &tab,
                &run_id_for_thread,
                start,
                &*stream_log,
            )
        })
        .await
        .unwrap_or(RunOutcome::Error("run stream task panicked".to_string()))
    };

    // Drop our active-run entry — a newer run may have already replaced it, so
    // only remove if it's still ours.
    {
        let mut scripts = state.active_scripts.lock().unwrap();
        if scripts.get(&tab_id).map(|a| a.request_id.as_str()) == Some(req_id.as_str()) {
            scripts.remove(&tab_id);
        }
    }

    let elapsed = start.elapsed().as_millis();
    match outcome {
        RunOutcome::Done => {
            log.info("run_script done", logctx! { "elapsedMs" => elapsed.to_string() });
            Ok(())
        }
        RunOutcome::TimedOut => {
            log.warn("run_script timed out", logctx! { "timeoutSecs" => SCRIPT_TIMEOUT_SECS });
            emit_error(
                &app,
                &tab_id,
                &run_id_str,
                format!("Script execution timed out ({SCRIPT_TIMEOUT_SECS}s)"),
            );
            // The harness was sent a cancel frame inside stream_run; the run is
            // abandoned from the UI's perspective regardless of the late __done.
            Ok(())
        }
        RunOutcome::HarnessDied => {
            // The harness exited mid-stream (channel closed before __done).
            // Surface it and let the next run respawn lazily.
            log.error("run_script: harness died mid-run", logctx! {});
            state.harness_procs.lock().unwrap().remove(&connection_id);
            emit_error(
                &app,
                &tab_id,
                &run_id_str,
                "Query runner stopped unexpectedly — retry the query.".to_string(),
            );
            Ok(())
        }
        RunOutcome::Error(msg) => {
            log.error("run_script error", logctx! { "err" => msg.clone() });
            Err(msg)
        }
    }
}

/// Terminal result of streaming one run request.
enum RunOutcome {
    /// Harness emitted `__done` — the run completed (success, per-statement
    /// error already surfaced as a `script-event`, or a honoured user cancel).
    Done,
    /// 30s budget elapsed without `__done`; a cancel frame was sent.
    TimedOut,
    /// The response channel closed before `__done` — the harness process exited.
    HarnessDied,
    /// Failed to send the request (dead stdin etc.).
    Error(String),
}

/// Send the `run` request, then drain the response channel emitting
/// `script-event`s until the terminal `__done`. Runs on a blocking thread.
#[allow(clippy::too_many_arguments)]
fn stream_run(
    harness: &HarnessHandle,
    req_id: &str,
    db: &str,
    script: &str,
    page: u32,
    page_size: u32,
    app: &AppHandle,
    tab_id: &str,
    run_id: &str,
    start: Instant,
    log: &dyn crate::logger::Logger,
) -> RunOutcome {
    let rx: Receiver<serde_json::Value> = match harness.send_run(req_id, db, script, page, page_size)
    {
        Ok(rx) => rx,
        Err(e) => return RunOutcome::Error(e),
    };

    // A user cancel (cancel_script) sends its own cancel frame to the harness;
    // the harness then ends this run with a terminal `__done`, so from here a
    // cancel is indistinguishable from normal completion — `Done` covers both.
    // The frontend drives the cancel UX off cancel_script, not off this event.
    let deadline = start + Duration::from_secs(SCRIPT_TIMEOUT_SECS);
    let outcome = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            // Budget elapsed. Ask the harness to stop; we stop waiting now
            // rather than block on the late __done.
            let _ = harness.send_cancel(req_id);
            break RunOutcome::TimedOut;
        }
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if line.get("__done").and_then(|v| v.as_bool()) == Some(true) {
                    break RunOutcome::Done;
                }
                emit_line(&line, app, tab_id, run_id, log);
            }
            Err(RecvTimeoutError::Timeout) => {
                let _ = harness.send_cancel(req_id);
                break RunOutcome::TimedOut;
            }
            Err(RecvTimeoutError::Disconnected) => break RunOutcome::HarnessDied,
        }
    };

    harness.finish_request(req_id);

    // Emit the terminal `done` event so the frontend gets the execution time
    // exactly as before. Timeout/death emit their own error event in the caller.
    if matches!(outcome, RunOutcome::Done) {
        let elapsed = start.elapsed().as_millis();
        let done = ScriptEvent {
            tab_id: tab_id.to_string(),
            kind: "done".into(),
            group_index: None,
            docs: None,
            error: None,
            execution_ms: Some(elapsed),
            pagination: None,
            run_id: Some(run_id.to_string()),
            collection: None,
            category: None,
            log: None,
        };
        let _ = app.emit("script-event", done);
    }
    outcome
}

/// Map one harness response line to a `script-event` and emit it. Mirrors the
/// per-child stdout tap exactly so the frontend contract is unchanged: the only
/// new key on the wire is the request `id`, which is consumed for routing
/// before this point and never forwarded.
fn emit_line(
    line: &serde_json::Value,
    app: &AppHandle,
    tab_id: &str,
    run_id: &str,
    log: &dyn crate::logger::Logger,
) {
    if let Some(pg) = line.get("__pagination") {
        if let (Some(total), Some(page_val), Some(page_size_val)) = (
            pg.get("total").and_then(|x| x.as_i64()),
            pg.get("page").and_then(|x| x.as_u64()),
            pg.get("pageSize").and_then(|x| x.as_u64()),
        ) {
            emit(
                app,
                ScriptEvent {
                    tab_id: tab_id.to_string(),
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
                    run_id: Some(run_id.to_string()),
                    collection: None,
                    category: None,
                    log: None,
                },
            );
        }
    } else if let Some(message) = line
        .get("__log")
        .and_then(|x| x.get("message"))
        .and_then(|x| x.as_str())
    {
        emit(
            app,
            ScriptEvent {
                tab_id: tab_id.to_string(),
                kind: "log".into(),
                group_index: None,
                docs: None,
                error: None,
                execution_ms: None,
                pagination: None,
                run_id: Some(run_id.to_string()),
                collection: None,
                category: None,
                log: Some(message.to_string()),
            },
        );
    } else if let Some(err) = line.get("__error").and_then(|x| x.as_str()) {
        emit(
            app,
            ScriptEvent {
                tab_id: tab_id.to_string(),
                kind: "error".into(),
                group_index: None,
                docs: None,
                error: Some(err.to_string()),
                execution_ms: None,
                pagination: None,
                run_id: Some(run_id.to_string()),
                collection: None,
                category: None,
                log: None,
            },
        );
    } else if let (Some(idx), Some(docs)) =
        (line.get("__group").and_then(|x| x.as_i64()), line.get("docs"))
    {
        let collection = line
            .get("collection")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let category = line
            .get("category")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        emit(
            app,
            ScriptEvent {
                tab_id: tab_id.to_string(),
                kind: "group".into(),
                group_index: Some(idx),
                docs: Some(docs.clone()),
                error: None,
                execution_ms: None,
                pagination: None,
                run_id: Some(run_id.to_string()),
                collection,
                category,
                log: None,
            },
        );
    } else {
        log.debug("harness line ignored", logctx! {});
    }
}

fn emit(app: &AppHandle, evt: ScriptEvent) {
    let _ = app.emit("script-event", evt);
}

fn emit_error(app: &AppHandle, tab_id: &str, run_id: &str, error: String) {
    emit(
        app,
        ScriptEvent {
            tab_id: tab_id.to_string(),
            kind: "error".into(),
            group_index: None,
            docs: None,
            error: Some(error),
            execution_ms: None,
            pagination: None,
            run_id: Some(run_id.to_string()),
            collection: None,
            category: None,
            log: None,
        },
    );
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
