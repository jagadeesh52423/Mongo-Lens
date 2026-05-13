use crate::keychain;
use crate::logctx;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn set_plugin_secret(
    state: State<'_, AppState>,
    namespace: String,
    value: String,
) -> Result<(), String> {
    let log = state.logger.child(logctx! { "logger" => "commands.plugin_secrets" });
    keychain::set_password(&namespace, &value, log.as_ref())
}

#[tauri::command]
pub fn get_plugin_secret(
    state: State<'_, AppState>,
    namespace: String,
) -> Result<Option<String>, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.plugin_secrets" });
    keychain::get_password(&namespace, log.as_ref())
}

#[tauri::command]
pub fn delete_plugin_secret(
    state: State<'_, AppState>,
    namespace: String,
) -> Result<(), String> {
    let log = state.logger.child(logctx! { "logger" => "commands.plugin_secrets" });
    keychain::delete_password(&namespace, log.as_ref())
}
