use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn set_plugin_secret(
    state: State<'_, AppState>,
    namespace: String,
    value: String,
) -> Result<(), String> {
    state
        .connection_secrets()
        .ok_or_else(|| "secret store not available".to_string())?
        .set_raw(&namespace, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_plugin_secret(
    state: State<'_, AppState>,
    namespace: String,
) -> Result<Option<String>, String> {
    state
        .connection_secrets()
        .ok_or_else(|| "secret store not available".to_string())?
        .get_raw(&namespace)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_plugin_secret(
    state: State<'_, AppState>,
    namespace: String,
) -> Result<(), String> {
    state
        .connection_secrets()
        .ok_or_else(|| "secret store not available".to_string())?
        .delete_raw(&namespace)
        .map_err(|e| e.to_string())
}
