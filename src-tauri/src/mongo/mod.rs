use crate::runner::HarnessHandle;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

pub mod authz;

/// Look up the live `mongodb::Client` for an active connection. Returns
/// an error if `connections_v2_connect` has not registered a client for
/// this id (i.e. the connection isn't currently open).
pub fn active_client(state: &State<'_, AppState>, id: &str) -> Result<mongodb::Client, String> {
    state
        .mongo_clients
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| "connection not active — connect first".to_string())
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
