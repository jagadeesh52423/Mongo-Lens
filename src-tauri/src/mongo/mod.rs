use crate::state::AppState;
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
