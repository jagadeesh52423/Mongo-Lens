use crate::runner::HarnessHandle;
use crate::state::AppState;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

/// Harness `data`-action op names — the wire contract with `DATA_OPS` in
/// runner/harness.js. Single source of truth on the Rust side; a typo otherwise
/// surfaces only at runtime as "unknown data op".
pub mod data_op {
    pub const LIST_DATABASES: &str = "listDatabases";
    pub const LIST_COLLECTIONS: &str = "listCollections";
    pub const LIST_INDEXES: &str = "listIndexes";
    pub const FIND: &str = "find";
    pub const UPDATE_ONE: &str = "updateOne";
    pub const DELETE_ONE: &str = "deleteOne";
    pub const ANALYZE_SCHEMA: &str = "analyzeSchema";
}

/// Wall-clock budget for one harness `data` op. Matches the script run budget so
/// a wedged control-plane op fails fast instead of hanging the command.
const DATA_TIMEOUT_SECS: u64 = 30;

/// Error from a harness `data` op. Carries the MongoDB error `code` when the
/// harness surfaced one, so callers can replay driver-specific fallbacks (e.g.
/// the Unauthorized=13 degrade in `list_databases`) without string-matching.
pub struct DataError {
    pub message: String,
    pub code: Option<i64>,
}

impl DataError {
    fn other(message: impl Into<String>) -> Self {
        DataError { message: message.into(), code: None }
    }
    /// True for an `Unauthorized` (code 13) failure, so callers can degrade
    /// gracefully (e.g. the `list_databases` default-db fallback).
    pub fn is_unauthorized(&self) -> bool {
        self.code == Some(13) || self.message.to_lowercase().contains("not authorized")
    }
}

impl From<DataError> for String {
    fn from(e: DataError) -> String {
        e.message
    }
}

/// Returns the URI that the v2 builder used to instantiate the cached
/// client (after any SSH-tunnel rewrite or fallback params). `None` if
/// the connection isn't active; the caller should treat that as a
/// hard error rather than re-deriving — see `commands::script::run_script`.
pub fn active_uri(state: &State<'_, AppState>, id: &str) -> Option<String> {
    state.mongo_uris.lock().unwrap().get(id).cloned()
}

/// Returns the runner credential for an active connection, if one was stored
/// at connect time (password-based auth modes only). Mirrors `active_uri` —
/// `None` means either the connection is not active or it uses non-password
/// auth (X509, no-auth, URI-embedded creds, etc.).
pub fn active_runner_cred(
    state: &State<'_, AppState>,
    id: &str,
) -> Option<crate::runner::RunnerCredential> {
    state.mongo_runner_creds.lock().unwrap().get(id).cloned()
}

/// Return the live harness for `id` if one is registered AND still alive. A
/// dead handle (its child exited / crashed) returns `None` so the caller falls
/// through to a lazy respawn via [`ensure_harness`].
pub fn active_harness(state: &State<'_, AppState>, id: &str) -> Option<Arc<HarnessHandle>> {
    let handle = state.harness_procs.lock().unwrap().get(id).cloned()?;
    if handle.is_alive() {
        Some(handle)
    } else {
        None
    }
}

/// Get the live harness for `id`, lazily respawning if absent or dead. Used by
/// `run_script` so a crashed harness self-heals on the next query instead of
/// requiring a manual reconnect. Respawns from the cached `mongo_uris` +
/// `mongo_runner_creds` (no secret-store round-trip) so it works even after the
/// dialog has closed. Returns an error only when the connection isn't active
/// (no cached URI) or the spawn itself fails.
///
/// `default_db` seeds the harness's idle `client.db()` target; every run
/// request still carries its own db, so the run's database is a fine seed.
pub async fn ensure_harness(
    state: &State<'_, AppState>,
    id: &str,
    default_db: &str,
    logger: Arc<dyn crate::logger::Logger>,
) -> Result<Arc<HarnessHandle>, String> {
    if let Some(handle) = active_harness(state, id) {
        return Ok(handle);
    }

    // Drop any dead handle so the map doesn't hold a zombie, then respawn.
    state.harness_procs.lock().unwrap().remove(id);

    let uri = active_uri(state, id)
        .ok_or_else(|| "connection not active — connect first".to_string())?;
    let cred = active_runner_cred(state, id);
    let node = crate::runner::executor::resolve_node()
        .ok_or("Node.js not found — check node installation")?;
    let level = std::env::var("MONGOMACAPP_LOG_LEVEL").unwrap_or_else(|_| "info".into());
    let run_id = uuid::Uuid::new_v4().to_string();
    let logs_dir = state.logs_dir.clone();
    let default_db = default_db.to_string();

    let handle = tokio::task::spawn_blocking(move || {
        HarnessHandle::spawn(
            node,
            &uri,
            &default_db,
            &logs_dir,
            &level,
            &run_id,
            cred.as_ref(),
            logger,
        )
    })
    .await
    .map_err(|e| format!("harness respawn task panicked: {e}"))??;

    let handle = Arc::new(handle);
    state
        .harness_procs
        .lock()
        .unwrap()
        .insert(id.to_string(), handle.clone());
    Ok(handle)
}

/// Run a single harness `data` op (the harness is the one Mongo data path) and
/// return its `__data` value. Ensures/respawns the harness, then drains the
/// response on a blocking thread (the harness channel is a std mpsc). `args`
/// carries the op's fields (collection, filter, update, page, pageSize).
pub async fn harness_data(
    state: &State<'_, AppState>,
    id: &str,
    db: &str,
    op: &str,
    args: serde_json::Value,
    logger: Arc<dyn crate::logger::Logger>,
) -> Result<serde_json::Value, DataError> {
    let harness = ensure_harness(state, id, db, logger)
        .await
        .map_err(DataError::other)?;
    let req_id = uuid::Uuid::new_v4().to_string();
    let op = op.to_string();
    let db = db.to_string();
    tokio::task::spawn_blocking(move || collect_data(&harness, &req_id, &op, &db, &args))
        .await
        .map_err(|e| DataError::other(format!("harness data task panicked: {e}")))?
}

/// Send the `data` request and drain the response channel until `__done`,
/// returning the `__data` value or a [`DataError`]. Runs on a blocking thread.
fn collect_data(
    harness: &HarnessHandle,
    req_id: &str,
    op: &str,
    db: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, DataError> {
    let rx = harness
        .send_data(req_id, op, db, args)
        .map_err(DataError::other)?;

    let mut data: Option<serde_json::Value> = None;
    let mut error: Option<DataError> = None;
    let outcome = loop {
        match rx.recv_timeout(Duration::from_secs(DATA_TIMEOUT_SECS)) {
            Ok(line) => {
                if let Some(d) = line.get("__data") {
                    data = Some(d.clone());
                } else if let Some(msg) = line.get("__error").and_then(|v| v.as_str()) {
                    error = Some(DataError {
                        message: msg.to_string(),
                        code: line.get("code").and_then(|v| v.as_i64()),
                    });
                }
                if line.get("__done").and_then(|v| v.as_bool()) == Some(true) {
                    break Ok(());
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                let _ = harness.send_cancel(req_id);
                break Err(DataError::other(format!(
                    "query runner timed out ({DATA_TIMEOUT_SECS}s)"
                )));
            }
            Err(RecvTimeoutError::Disconnected) => {
                break Err(DataError::other(
                    "query runner stopped unexpectedly — reconnect and retry".to_string(),
                ));
            }
        }
    };
    harness.finish_request(req_id);
    outcome?;

    if let Some(e) = error {
        return Err(e);
    }
    data.ok_or_else(|| DataError::other("query runner returned no data".to_string()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn analyze_schema_op_name_matches_harness() {
        assert_eq!(super::data_op::ANALYZE_SCHEMA, "analyzeSchema");
    }
}

/// Convert one Extended-JSON value the harness emitted (canonical EJSON, so BSON
/// types survive) back into the `serde_json::Value` shape the Rust mongodb
/// driver produced before these ops moved to the harness: parse to `Bson`, then
/// emit relaxed Extended JSON — byte-identical to the old `to_bson(&doc).into()`
/// path, keeping the frontend document shape unchanged.
pub fn ejson_to_value(value: serde_json::Value) -> Result<serde_json::Value, String> {
    let bson = mongodb::bson::Bson::try_from(value)
        .map_err(|e| format!("decode harness document: {e}"))?;
    Ok(bson.into())
}
