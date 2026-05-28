//! Wire-format contract tests for the connection model.
//!
//! Every JSON file in `tests/fixtures/connection/` is the source of truth
//! for one shape of connection. For each fixture we:
//!   1. Parse it to `serde_json::Value` (the "expected" tree).
//!   2. Deserialize it into our typed `Connection` model.
//!   3. Re-serialize the typed model back to `serde_json::Value`.
//!   4. Assert structural equality between the two `Value`s.
//!
//! Comparing `Value`s (not strings) makes the test insensitive to key
//! order and whitespace while still catching every meaningful drift —
//! a missing field, a wrong enum tag, an unwanted `null`, a renamed key.

use super::model::Connection;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Locate the workspace-root `tests/fixtures/connection/` directory.
///
/// `CARGO_MANIFEST_DIR` points at `src-tauri/`; fixtures live one level up.
fn fixtures_dir() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .expect("src-tauri has a parent")
        .join("tests")
        .join("fixtures")
        .join("connection")
}

/// Collect every `*.json` fixture file at the **top level** of the
/// fixtures dir, sorted for stable test ordering.
///
/// The dir also contains `legacy/` and `migrated/` subdirectories (paired
/// fixtures for Task 4's migration logic — see src/connection/migration*).
/// Those are validated by the TS migration tests and must NOT be
/// round-tripped here: they intentionally use a different shape.
/// We mirror `model.test.ts`'s non-recursive `*.json` glob by filtering
/// to regular files with a `.json` extension only.
fn fixture_files() -> Vec<PathBuf> {
    let dir = fixtures_dir();
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read fixtures dir {}: {e}", dir.display()))
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect();
    paths.sort();
    paths
}

#[test]
fn fixture_count_meets_contract() {
    // Plan §Task 2 mandates at least 16 fixtures (the matrix locked in
    // Task 1). A drop below 16 means someone deleted a fixture; a
    // significant rise should be intentional, not silent.
    let count = fixture_files().len();
    assert!(
        count >= 16,
        "expected ≥16 connection fixtures, found {count}"
    );
}

#[test]
fn every_fixture_round_trips_structurally() {
    let files = fixture_files();
    assert!(!files.is_empty(), "no fixtures found — wrong path?");

    let mut failures: Vec<String> = Vec::new();

    for path in &files {
        let raw = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(err) => {
                failures.push(format!("{}: read failed: {err}", path.display()));
                continue;
            }
        };

        let expected: Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(err) => {
                failures.push(format!("{}: not valid JSON: {err}", path.display()));
                continue;
            }
        };

        let typed: Connection = match serde_json::from_str(&raw) {
            Ok(connection) => connection,
            Err(err) => {
                failures.push(format!(
                    "{}: deserialize into Connection failed: {err}",
                    path.display()
                ));
                continue;
            }
        };

        let actual: Value = match serde_json::to_value(&typed) {
            Ok(value) => value,
            Err(err) => {
                failures.push(format!(
                    "{}: re-serialize Connection failed: {err}",
                    path.display()
                ));
                continue;
            }
        };

        if actual != expected {
            failures.push(format!(
                "{}: round-trip mismatch\n  expected: {}\n  actual:   {}",
                path.display(),
                serde_json::to_string_pretty(&expected).unwrap_or_default(),
                serde_json::to_string_pretty(&actual).unwrap_or_default(),
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "fixture round-trip failures ({}):\n{}",
        failures.len(),
        failures.join("\n\n")
    );
}
