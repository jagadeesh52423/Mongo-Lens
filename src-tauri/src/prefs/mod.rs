// Global prefs module.
//
// Public API:
//   * `load(handle)`            — read GlobalPrefs from the persisted store,
//                                 returning Default if the key is absent.
//   * `save(handle, &prefs)`    — persist GlobalPrefs.
//   * `resolve_effective(g, o)` — pure per-field merge of GlobalPrefs and
//                                 connection-scoped `Overrides`. Mirrors
//                                 TS `resolveEffective` (src/connection/
//                                 overrides.ts) exactly.
//
// Storage: tauri-plugin-store, single store file `global_prefs.json` keyed
// by `GLOBAL_PREFS_KEY`. The store file lives under Tauri's app-data dir;
// the plugin handles serialization, debounced auto-save and concurrent
// access. We only marshal between `GlobalPrefs` and `serde_json::Value`.
//
// Resolution semantics (see overrides.test.ts):
//   * `Some(v)` overrides — including `false`, `0`, `""`, empty Vec.
//   * `None` inherits the global value.
//   * Arrays REPLACE wholesale — they do not merge.

pub mod model;

use crate::connection::model::{
    AdvancedOverrides, IntelliShellOverrides, Overrides, ToolsOverrides,
};
use model::{AdvancedPrefs, EffectivePrefs, GlobalPrefs, IntelliShellPrefs, ToolsPrefs};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// Filename for the global prefs store. Resolved relative to the app-data
/// dir by tauri-plugin-store. Kept as a constant so the IPC layer
/// (Task 12) and any future migrations reference the same path.
const STORE_FILE: &str = "global_prefs.json";

/// Key under which the serialized `GlobalPrefs` is stored.
const GLOBAL_PREFS_KEY: &str = "global_prefs";

/// Errors surfaced by the prefs module. Kept small — load/save funnels
/// store-plugin errors and JSON (de)serialization failures.
#[derive(Debug, thiserror::Error)]
pub enum PrefsError {
    #[error("prefs store error: {0}")]
    Store(#[from] tauri_plugin_store::Error),
    #[error("prefs (de)serialize error: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, PrefsError>;

/// Load `GlobalPrefs` from the persisted store. Returns `GlobalPrefs::default()`
/// when the key is absent (first run / never saved).
pub fn load<R: Runtime>(handle: &AppHandle<R>) -> Result<GlobalPrefs> {
    let store = handle.store(STORE_FILE)?;
    match store.get(GLOBAL_PREFS_KEY) {
        Some(value) => Ok(serde_json::from_value(value)?),
        None => Ok(GlobalPrefs::default()),
    }
}

/// Persist `GlobalPrefs` to the store. The store has debounced auto-save
/// by default; we additionally call `save()` to flush synchronously so
/// callers can rely on durability after this returns.
pub fn save<R: Runtime>(handle: &AppHandle<R>, prefs: &GlobalPrefs) -> Result<()> {
    let store = handle.store(STORE_FILE)?;
    let value = serde_json::to_value(prefs)?;
    store.set(GLOBAL_PREFS_KEY, value);
    store.save()?;
    Ok(())
}

/// Pure per-field merge of `GlobalPrefs` with connection-scoped
/// `Overrides`. Mirrors TS `resolveEffective` semantics exactly:
///   * `Some(v)` overrides the global field — including `false`, `0`, ""
///     and empty `Vec`.
///   * `None` inherits the global value.
///   * `Vec` fields replace wholesale; they do NOT merge.
///
/// Neither input is mutated; the result is a freshly-owned struct.
pub fn resolve_effective(global: &GlobalPrefs, overrides: Option<&Overrides>) -> EffectivePrefs {
    let intelli = overrides.and_then(|o| o.intelli_shell.as_ref());
    let tools = overrides.and_then(|o| o.tools.as_ref());
    let advanced = overrides.and_then(|o| o.advanced.as_ref());

    EffectivePrefs {
        intelli_shell: merge_intelli(&global.intelli_shell, intelli),
        tools: merge_tools(&global.tools, tools),
        advanced: merge_advanced(&global.advanced, advanced),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-block merges. Each helper takes the resolved global block and an
// optional partial override block, returning a freshly-owned resolved
// block. Field-by-field: `Some(v) → use override; None → inherit`.
// Kept as private free functions; no shared trait because the override
// and resolved types have different field shapes (Option<T> vs T).
// ──────────────────────────────────────────────────────────────────────────

fn merge_intelli(
    global: &IntelliShellPrefs,
    override_block: Option<&IntelliShellOverrides>,
) -> IntelliShellPrefs {
    let Some(o) = override_block else {
        return global.clone();
    };
    IntelliShellPrefs {
        command_timeout_ms: o.command_timeout_ms.unwrap_or(global.command_timeout_ms),
        auto_complete_enabled: o
            .auto_complete_enabled
            .unwrap_or(global.auto_complete_enabled),
        print_limit: o.print_limit.unwrap_or(global.print_limit),
    }
}

fn merge_tools(global: &ToolsPrefs, override_block: Option<&ToolsOverrides>) -> ToolsPrefs {
    let Some(o) = override_block else {
        return global.clone();
    };
    ToolsPrefs {
        mongodump_path: o
            .mongodump_path
            .clone()
            .unwrap_or_else(|| global.mongodump_path.clone()),
        mongorestore_path: o
            .mongorestore_path
            .clone()
            .unwrap_or_else(|| global.mongorestore_path.clone()),
        mongoexport_path: o
            .mongoexport_path
            .clone()
            .unwrap_or_else(|| global.mongoexport_path.clone()),
        mongoimport_path: o
            .mongoimport_path
            .clone()
            .unwrap_or_else(|| global.mongoimport_path.clone()),
    }
}

fn merge_advanced(
    global: &AdvancedPrefs,
    override_block: Option<&AdvancedOverrides>,
) -> AdvancedPrefs {
    let Some(o) = override_block else {
        return global.clone();
    };
    AdvancedPrefs {
        app_name: o.app_name.clone().unwrap_or_else(|| global.app_name.clone()),
        retry_writes: o.retry_writes.unwrap_or(global.retry_writes),
        retry_reads: o.retry_reads.unwrap_or(global.retry_reads),
        // Arrays replace wholesale — Some(vec![]) replaces with empty;
        // only None inherits.
        compressors: o
            .compressors
            .clone()
            .unwrap_or_else(|| global.compressors.clone()),
        server_selection_timeout_ms: o
            .server_selection_timeout_ms
            .unwrap_or(global.server_selection_timeout_ms),
        connect_timeout_ms: o.connect_timeout_ms.unwrap_or(global.connect_timeout_ms),
        socket_timeout_ms: o.socket_timeout_ms.unwrap_or(global.socket_timeout_ms),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Tests — port of src/connection/__tests__/overrides.test.ts (Task 3).
// Each `it(...)` block in the TS suite maps to one #[test] here with the
// same assertions. `load`/`save` are exercised by IPC integration tests
// (Task 12) — they require a Tauri app handle and so cannot be unit-tested
// at this layer.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::model::Compressor;

    fn global() -> GlobalPrefs {
        GlobalPrefs::default()
    }

    #[test]
    fn default_matches_ts_fixture() {
        // Sanity check that our Default impl agrees with the TS test's
        // `GLOBAL` literal. If this drifts, the per-test assertions
        // (which mirror that literal) will silently lose meaning.
        let g = global();
        assert_eq!(g.intelli_shell.command_timeout_ms, 30_000);
        assert_eq!(g.intelli_shell.auto_complete_enabled, true);
        assert_eq!(g.intelli_shell.print_limit, 1_000);
        assert_eq!(g.tools.mongodump_path, "/usr/bin/mongodump");
        assert_eq!(g.tools.mongorestore_path, "/usr/bin/mongorestore");
        assert_eq!(g.tools.mongoexport_path, "/usr/bin/mongoexport");
        assert_eq!(g.tools.mongoimport_path, "/usr/bin/mongoimport");
        assert_eq!(g.advanced.app_name, "mongo-lens");
        assert_eq!(g.advanced.retry_writes, true);
        assert_eq!(g.advanced.retry_reads, true);
        assert_eq!(g.advanced.compressors, vec![Compressor::Snappy]);
        assert_eq!(g.advanced.server_selection_timeout_ms, 30_000);
        assert_eq!(g.advanced.connect_timeout_ms, 10_000);
        assert_eq!(g.advanced.socket_timeout_ms, 0);
    }

    #[test]
    fn returns_global_when_no_overrides_at_all() {
        let g = global();
        let effective = resolve_effective(&g, None);
        assert_eq!(effective.intelli_shell, g.intelli_shell);
        assert_eq!(effective.tools, g.tools);
        assert_eq!(effective.advanced, g.advanced);
    }

    #[test]
    fn returns_global_when_overrides_is_empty() {
        let g = global();
        let empty = Overrides {
            intelli_shell: None,
            tools: None,
            advanced: None,
        };
        let effective = resolve_effective(&g, Some(&empty));
        assert_eq!(effective.intelli_shell, g.intelli_shell);
        assert_eq!(effective.tools, g.tools);
        assert_eq!(effective.advanced, g.advanced);
    }

    #[test]
    fn returns_global_when_individual_blocks_are_empty() {
        let g = global();
        let empty_blocks = Overrides {
            intelli_shell: Some(IntelliShellOverrides {
                command_timeout_ms: None,
                auto_complete_enabled: None,
                print_limit: None,
            }),
            tools: Some(ToolsOverrides {
                mongodump_path: None,
                mongorestore_path: None,
                mongoexport_path: None,
                mongoimport_path: None,
            }),
            advanced: Some(AdvancedOverrides {
                app_name: None,
                retry_writes: None,
                retry_reads: None,
                compressors: None,
                server_selection_timeout_ms: None,
                connect_timeout_ms: None,
                socket_timeout_ms: None,
            }),
        };
        let effective = resolve_effective(&g, Some(&empty_blocks));
        assert_eq!(effective.intelli_shell, g.intelli_shell);
        assert_eq!(effective.tools, g.tools);
        assert_eq!(effective.advanced, g.advanced);
    }

    #[test]
    fn per_field_override_applies() {
        let g = global();
        let overrides = Overrides {
            intelli_shell: Some(IntelliShellOverrides {
                command_timeout_ms: Some(5_000),
                auto_complete_enabled: None,
                print_limit: None,
            }),
            tools: None,
            advanced: None,
        };
        let effective = resolve_effective(&g, Some(&overrides));
        assert_eq!(effective.intelli_shell.command_timeout_ms, 5_000);
        // Inherited
        assert_eq!(effective.intelli_shell.auto_complete_enabled, true);
        assert_eq!(effective.intelli_shell.print_limit, 1_000);
    }

    #[test]
    fn none_means_inherit_not_set_to_undefined() {
        // Rust analogue of the TS "undefined means inherit" assertion:
        // an override with all fields set to None must not zero anything out.
        let g = global();
        let overrides = Overrides {
            intelli_shell: Some(IntelliShellOverrides {
                command_timeout_ms: None,
                auto_complete_enabled: None,
                print_limit: None,
            }),
            tools: None,
            advanced: None,
        };
        let effective = resolve_effective(&g, Some(&overrides));
        assert_eq!(effective.intelli_shell.command_timeout_ms, 30_000);
    }

    #[test]
    fn false_is_distinct_from_none_and_does_override() {
        let g = global();
        let overrides = Overrides {
            intelli_shell: None,
            tools: None,
            advanced: Some(AdvancedOverrides {
                app_name: None,
                retry_writes: Some(false),
                retry_reads: None,
                compressors: None,
                server_selection_timeout_ms: None,
                connect_timeout_ms: None,
                socket_timeout_ms: None,
            }),
        };
        let effective = resolve_effective(&g, Some(&overrides));
        assert_eq!(effective.advanced.retry_writes, false);
        // Untouched field still inherits.
        assert_eq!(effective.advanced.retry_reads, true);
    }

    #[test]
    fn zero_is_distinct_from_none_and_does_override() {
        let g = global();
        let overrides = Overrides {
            intelli_shell: Some(IntelliShellOverrides {
                command_timeout_ms: None,
                auto_complete_enabled: None,
                print_limit: Some(0),
            }),
            tools: None,
            advanced: None,
        };
        let effective = resolve_effective(&g, Some(&overrides));
        assert_eq!(effective.intelli_shell.print_limit, 0);
    }

    #[test]
    fn array_override_replaces_does_not_merge() {
        let g = global();
        let overrides = Overrides {
            intelli_shell: None,
            tools: None,
            advanced: Some(AdvancedOverrides {
                app_name: None,
                retry_writes: None,
                retry_reads: None,
                compressors: Some(vec![Compressor::Zstd]),
                server_selection_timeout_ms: None,
                connect_timeout_ms: None,
                socket_timeout_ms: None,
            }),
        };
        let effective = resolve_effective(&g, Some(&overrides));
        assert_eq!(effective.advanced.compressors, vec![Compressor::Zstd]);
    }

    #[test]
    fn empty_array_override_replaces_with_empty() {
        let g = global();
        let overrides = Overrides {
            intelli_shell: None,
            tools: None,
            advanced: Some(AdvancedOverrides {
                app_name: None,
                retry_writes: None,
                retry_reads: None,
                compressors: Some(vec![]),
                server_selection_timeout_ms: None,
                connect_timeout_ms: None,
                socket_timeout_ms: None,
            }),
        };
        let effective = resolve_effective(&g, Some(&overrides));
        assert!(effective.advanced.compressors.is_empty());
    }

    #[test]
    fn overrides_multiple_blocks_simultaneously() {
        let g = global();
        let overrides = Overrides {
            intelli_shell: Some(IntelliShellOverrides {
                command_timeout_ms: Some(1_000),
                auto_complete_enabled: None,
                print_limit: None,
            }),
            tools: Some(ToolsOverrides {
                mongodump_path: Some("/opt/mongodump".to_string()),
                mongorestore_path: None,
                mongoexport_path: None,
                mongoimport_path: None,
            }),
            advanced: Some(AdvancedOverrides {
                app_name: Some("custom".to_string()),
                retry_writes: None,
                retry_reads: None,
                compressors: None,
                server_selection_timeout_ms: None,
                connect_timeout_ms: None,
                socket_timeout_ms: None,
            }),
        };
        let effective = resolve_effective(&g, Some(&overrides));
        assert_eq!(effective.intelli_shell.command_timeout_ms, 1_000);
        assert_eq!(effective.tools.mongodump_path, "/opt/mongodump");
        assert_eq!(effective.advanced.app_name, "custom");
        // Untouched fields still inherit.
        assert_eq!(effective.tools.mongorestore_path, "/usr/bin/mongorestore");
        assert_eq!(effective.advanced.retry_writes, true);
    }

    #[test]
    fn does_not_mutate_input_global() {
        let g = global();
        let snapshot = g.clone();
        let overrides = Overrides {
            intelli_shell: Some(IntelliShellOverrides {
                command_timeout_ms: Some(1),
                auto_complete_enabled: None,
                print_limit: None,
            }),
            tools: None,
            advanced: None,
        };
        let _ = resolve_effective(&g, Some(&overrides));
        assert_eq!(g, snapshot);
    }

    #[test]
    fn does_not_mutate_input_overrides() {
        let g = global();
        let overrides = Overrides {
            intelli_shell: Some(IntelliShellOverrides {
                command_timeout_ms: Some(1),
                auto_complete_enabled: None,
                print_limit: None,
            }),
            tools: None,
            advanced: None,
        };
        let snapshot = overrides.clone();
        let _ = resolve_effective(&g, Some(&overrides));
        assert_eq!(overrides, snapshot);
    }

    #[test]
    fn global_prefs_round_trips_through_json_camel_case() {
        // Wire-format contract: GlobalPrefs JSON keys MUST be camelCase
        // (matching the TS GlobalPrefs shape). A round-trip with explicit
        // key inspection guards against accidental serde drift.
        let g = global();
        let value = serde_json::to_value(&g).expect("serialize");
        let obj = value.as_object().expect("object");
        assert!(obj.contains_key("intelliShell"));
        assert!(obj.contains_key("tools"));
        assert!(obj.contains_key("advanced"));
        let intelli = obj["intelliShell"].as_object().expect("intelliShell object");
        assert!(intelli.contains_key("commandTimeoutMs"));
        assert!(intelli.contains_key("autoCompleteEnabled"));
        assert!(intelli.contains_key("printLimit"));

        let back: GlobalPrefs = serde_json::from_value(value).expect("deserialize");
        assert_eq!(back, g);
    }
}
