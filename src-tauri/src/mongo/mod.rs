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
