// IPC commands for global preferences and per-connection effective prefs.
// Gated at the registration site by `CONN_V2` (see `main.rs`); this
// module never assumes the v2 secret store is installed.
//
// Wire surface — JSON keys camelCase, matching the TS twins in
// `src/connection/ipc.ts`:
//
//   prefs_get                ()                        -> GlobalPrefs
//   prefs_set                (prefs: GlobalPrefs)      -> ()
//   prefs_resolve_effective  (connectionId: String)    -> EffectivePrefs
//
// `prefs_resolve_effective` reads the connection's `overrides` field
// from `connections_v2` and merges it with the global prefs via the
// pure `prefs::resolve_effective` (mirrored from TS — see prefs/mod.rs).

use crate::connection::store as conn_store;
use crate::logctx;
use crate::prefs;
use crate::prefs::model::{EffectivePrefs, GlobalPrefs};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn prefs_get(state: State<'_, AppState>, handle: AppHandle) -> Result<GlobalPrefs, String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.prefs" });
    log.info("prefs_get", logctx! {});
    prefs::load(&handle).map_err(|e| {
        log.error("prefs::load failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
}

#[tauri::command]
pub fn prefs_set(
    state: State<'_, AppState>,
    handle: AppHandle,
    prefs: GlobalPrefs,
) -> Result<(), String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.prefs" });
    log.info("prefs_set", logctx! {});
    prefs::save(&handle, &prefs).map_err(|e| {
        log.error("prefs::save failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
}

/// Resolve the effective prefs for a specific connection: load the global
/// prefs, fetch the connection's `overrides` block, return the merged
/// `EffectivePrefs`. Returns an error if the connection id is unknown
/// (the frontend uses this lookup to populate per-connection UI; a
/// silently-empty response would mask a stale connection id).
#[tauri::command]
pub fn prefs_resolve_effective(
    state: State<'_, AppState>,
    handle: AppHandle,
    #[allow(non_snake_case)] connectionId: String,
) -> Result<EffectivePrefs, String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.prefs" });
    log.info(
        "prefs_resolve_effective",
        logctx! { "connId" => connectionId.clone() },
    );

    let global = prefs::load(&handle).map_err(|e| {
        log.error("prefs::load failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    let db = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    let connection = conn_store::get(&db, &connectionId)
        .map_err(|e| {
            log.error("store::get failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?
        .ok_or_else(|| {
            log.warn(
                "prefs_resolve_effective: connection not found",
                logctx! { "connId" => connectionId.clone() },
            );
            format!("connection not found: {connectionId}")
        })?;

    Ok(prefs::resolve_effective(
        &global,
        connection.overrides.as_ref(),
    ))
}
