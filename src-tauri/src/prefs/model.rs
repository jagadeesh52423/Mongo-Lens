// Global preferences — fully-populated defaults that per-connection
// `Overrides` shadow on a per-field basis.
//
// Wire-format contract (camelCase JSON keys, no tag) mirrors the TS shape
// in src/connection/overrides.ts (Task 3). The resolved `EffectivePrefs`
// has the same field shape as `GlobalPrefs` — every field is concrete
// (no `Option`) because resolution always picks either the override or
// the global default.
//
// The per-field `Override` types live in `crate::connection::model`
// (Task 2). Resolution semantics: `Some(v)` overrides, `None` inherits.
// Arrays replace wholesale — they do not merge.

use crate::connection::model::Compressor;
use serde::{Deserialize, Serialize};

// ──────────────────────────────────────────────────────────────────────────
// Resolved per-block prefs
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntelliShellPrefs {
    pub command_timeout_ms: u64,
    pub auto_complete_enabled: bool,
    pub print_limit: u64,
}

impl Default for IntelliShellPrefs {
    fn default() -> Self {
        Self {
            command_timeout_ms: 30_000,
            auto_complete_enabled: true,
            print_limit: 1_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsPrefs {
    pub mongodump_path: String,
    pub mongorestore_path: String,
    pub mongoexport_path: String,
    pub mongoimport_path: String,
}

impl Default for ToolsPrefs {
    fn default() -> Self {
        Self {
            mongodump_path: "/usr/bin/mongodump".to_string(),
            mongorestore_path: "/usr/bin/mongorestore".to_string(),
            mongoexport_path: "/usr/bin/mongoexport".to_string(),
            mongoimport_path: "/usr/bin/mongoimport".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedPrefs {
    pub app_name: String,
    pub retry_writes: bool,
    pub retry_reads: bool,
    pub compressors: Vec<Compressor>,
    pub server_selection_timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub socket_timeout_ms: u64,
}

impl Default for AdvancedPrefs {
    fn default() -> Self {
        Self {
            app_name: "mongo-lens".to_string(),
            retry_writes: true,
            retry_reads: true,
            compressors: vec![Compressor::Snappy],
            server_selection_timeout_ms: 30_000,
            connect_timeout_ms: 10_000,
            socket_timeout_ms: 0,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GlobalPrefs / EffectivePrefs
// ──────────────────────────────────────────────────────────────────────────

/// Global, fully-populated preferences. Persisted via tauri-plugin-store.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalPrefs {
    #[serde(rename = "intelliShell")]
    pub intelli_shell: IntelliShellPrefs,
    pub tools: ToolsPrefs,
    pub advanced: AdvancedPrefs,
}

/// Resolved preferences for a specific connection — `GlobalPrefs` with any
/// per-field `Overrides` applied. Same field shape as `GlobalPrefs`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePrefs {
    #[serde(rename = "intelliShell")]
    pub intelli_shell: IntelliShellPrefs,
    pub tools: ToolsPrefs,
    pub advanced: AdvancedPrefs,
}
