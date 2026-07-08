use crate::logctx;
use crate::logger::Logger;
use crate::runner::{harness_path, node_modules_dir, runner_dir};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

static NODE_PATH: OnceLock<String> = OnceLock::new();

/// Runtime JS modules the harness `require`s, each paired with its bundled
/// (compile-time) source embedded via `include_str!`. The bundle and the binary
/// are versioned together, so writing bundled → installed is always correct;
/// the deploy-by-copy guard relies on that to self-heal a stale or partial
/// `~/.mongomacapp/runner` left behind by an earlier build.
///
/// require graph: harness.js → logger.js → redact.js; harness.js → query-classifier.js.
///
/// To add a new runtime sibling: add an `include_str!` const below and one entry
/// to `bundled_runtime_files()`. Both the clean install (`write_runner_files`)
/// and the self-heal (`verify_runner_integrity`) iterate that list — no other edits.
const BUNDLED_HARNESS: &str = include_str!("../../../runner/harness.js");
const BUNDLED_LOGGER: &str = include_str!("../../../runner/logger.js");
const BUNDLED_REDACT: &str = include_str!("../../../runner/redact.js");
const BUNDLED_QUERY_CLASSIFIER: &str = include_str!("../../../runner/query-classifier.js");

const RUNNER_PACKAGE_JSON: &str =
    r#"{"name":"mongomacapp-runner","version":"1.0.0","dependencies":{"mongodb":"^6.8.0","mongodb-schema":"^12.2.0"}}"#;

/// Single source of truth for the bundled runtime JS set. See the module-level
/// docs above to add a file.
fn bundled_runtime_files() -> [(&'static str, &'static str); 4] {
    [
        ("harness.js", BUNDLED_HARNESS),
        ("logger.js", BUNDLED_LOGGER),
        ("redact.js", BUNDLED_REDACT),
        ("query-classifier.js", BUNDLED_QUERY_CLASSIFIER),
    ]
}

// Run the integrity check at most once per process.
static INTEGRITY_CHECKED: OnceLock<()> = OnceLock::new();

/// Deploy-by-copy guard, run at most once per process. Public to the crate so
/// the persistent-harness spawn path (`runner::harness`) triggers the same
/// self-heal the legacy per-child spawn relied on.
pub(crate) fn ensure_integrity_checked(logger: &dyn Logger) {
    INTEGRITY_CHECKED.get_or_init(|| verify_runner_integrity(logger));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatus {
    pub ready: bool,
    pub node_version: Option<String>,
    pub message: Option<String>,
}

/// Resolve node binary path via login shell once, cache in NODE_PATH.
pub(crate) fn resolve_node() -> Option<&'static str> {
    let path = NODE_PATH.get_or_init(|| {
        // Use $SHELL so bash/fish users get their login PATH; fall back to zsh.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Command::new(&shell)
            .args(["-l", "-c", "which node"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    });
    if path.is_empty() { None } else { Some(path.as_str()) }
}

pub fn check_runner() -> RunnerStatus {
    let node_path = resolve_node();
    let node_version = node_path.and_then(|p| {
        Command::new(p).arg("--version").output().ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    });
    if node_version.is_none() {
        return RunnerStatus {
            ready: false,
            node_version: None,
            message: Some("Node.js not found on PATH. Install Node 18+.".into()),
        };
    }
    // Both deps must be present, so an existing install (which already has
    // `mongodb`) re-runs `npm install` to pick up `mongodb-schema`.
    let installed = node_modules_dir().join("mongodb").is_dir()
        && node_modules_dir().join("mongodb-schema").is_dir();
    let harness_ok = harness_path().is_file();
    let ready = installed && harness_ok;
    RunnerStatus {
        ready,
        node_version,
        message: if ready {
            None
        } else {
            Some("mongodb package not yet installed — run install_node_runner.".into())
        },
    }
}

/// Write every bundled runtime JS module plus a fresh `package.json` into `dir`.
/// Pure file-system work (no npm), so it can be unit-tested against a tempdir.
/// Does not touch `node_modules` — that is npm-managed by `install_runner`.
fn write_runner_files(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for (name, content) in bundled_runtime_files() {
        fs::write(dir.join(name), content).map_err(|e| e.to_string())?;
    }
    fs::write(dir.join("package.json"), RUNNER_PACKAGE_JSON).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn install_runner() -> Result<(), String> {
    let dir = runner_dir();
    write_runner_files(&dir)?;
    // Resolve npm next to node binary
    let node = resolve_node().ok_or("Node.js not found")?;
    let npm = PathBuf::from(node).parent().unwrap().join("npm");
    let status = Command::new(npm)
        .arg("install")
        .arg("--silent")
        .arg("--no-audit")
        .arg("--no-fund")
        .current_dir(&dir)
        .status()
        .map_err(|e| format!("failed to run npm install: {}", e))?;
    if !status.success() {
        return Err("npm install failed".into());
    }
    Ok(())
}

#[tauri::command]
pub fn check_node_runner() -> RunnerStatus {
    check_runner()
}

#[tauri::command]
pub fn install_node_runner() -> Result<(), String> {
    install_runner()
}

#[derive(PartialEq, Debug)]
enum FileIntegrity {
    Match,
    Drift,
    Missing,
    Unreadable,
}

/// Classify an installed runtime file against its bundled source. `Missing` (the
/// file simply isn't there) is self-healable; `Unreadable` (a genuine I/O error
/// — permission denied, a directory where the file should be) is not, so it is
/// warned and left untouched rather than silently "healed".
fn classify_file(read: &io::Result<String>, bundled: &str) -> FileIntegrity {
    match read {
        Ok(content) if content == bundled => FileIntegrity::Match,
        Ok(_) => FileIntegrity::Drift,
        Err(e) if e.kind() == io::ErrorKind::NotFound => FileIntegrity::Missing,
        Err(_) => FileIntegrity::Unreadable,
    }
}

// FNV-1a 64-bit — dependency-free short content fingerprint for log lines, so a
// heal log carries a comparable id without dumping whole files.
fn fingerprint(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

struct HealReport {
    healed: Vec<&'static str>,
    unreadable: Vec<&'static str>,
}

/// Rewrite each drifted or missing runtime file in `dir` from its bundled
/// source; leave genuinely unreadable files untouched. `dir` must already exist
/// (callers guard on the runner being installed). Pure file-system work so it is
/// unit-testable against a tempdir.
fn heal_runner_files(dir: &Path) -> HealReport {
    let mut healed = Vec::new();
    let mut unreadable = Vec::new();
    for (name, bundled) in bundled_runtime_files() {
        let path = dir.join(name);
        match classify_file(&fs::read_to_string(&path), bundled) {
            FileIntegrity::Match => {}
            FileIntegrity::Drift | FileIntegrity::Missing => match fs::write(&path, bundled) {
                Ok(()) => healed.push(name),
                Err(_) => unreadable.push(name),
            },
            FileIntegrity::Unreadable => unreadable.push(name),
        }
    }
    HealReport { healed, unreadable }
}

/// Deploy-by-copy guard, run once per process: self-heal any installed runtime
/// JS that has drifted from — or gone missing relative to — the bundled source,
/// so a stale `~/.mongomacapp/runner` from an earlier build cannot make the new
/// binary spawn divergent code (the cause of "harness did not become ready"
/// timeouts). Genuine read errors are warned, never overwritten.
fn verify_runner_integrity(logger: &dyn Logger) {
    let dir = runner_dir();
    match dir.try_exists() {
        Ok(true) => {}
        Ok(false) => {
            logger.debug(
                "runner integrity check skipped — runner not installed",
                logctx! { "dir" => dir.display().to_string() },
            );
            return;
        }
        Err(e) => {
            logger.warn(
                "runner integrity check skipped — runner dir unreadable",
                logctx! { "dir" => dir.display().to_string(), "error" => e.to_string() },
            );
            return;
        }
    }

    let report = heal_runner_files(&dir);
    if !report.healed.is_empty() {
        logger.info(
            "runner self-healed — rewrote stale/missing harness files from the bundled source",
            logctx! {
                "healed" => report.healed.join(","),
                "dir" => dir.display().to_string(),
                "bundledHarnessFingerprint" => fingerprint(BUNDLED_HARNESS),
            },
        );
    }
    if !report.unreadable.is_empty() {
        logger.warn(
            "runner integrity — harness files unreadable, left as-is (check permissions)",
            logctx! {
                "unreadable" => report.unreadable.join(","),
                "dir" => dir.display().to_string(),
            },
        );
    }
    if report.healed.is_empty() && report.unreadable.is_empty() {
        logger.debug(
            "runner integrity ok",
            logctx! { "fingerprint" => fingerprint(BUNDLED_HARNESS) },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_runner_files_creates_every_runtime_file() {
        // Regression for B-1: a clean install must produce every JS file the
        // harness requires at runtime — including query-classifier.js, which was
        // previously omitted — not just harness.js.
        let dir = tempdir().unwrap();
        write_runner_files(dir.path()).unwrap();
        for required in [
            "harness.js",
            "logger.js",
            "redact.js",
            "query-classifier.js",
            "package.json",
        ] {
            assert!(
                dir.path().join(required).is_file(),
                "expected {required} to be written into runner dir"
            );
        }
    }

    #[test]
    fn write_runner_files_writes_exact_bundled_content() {
        let dir = tempdir().unwrap();
        write_runner_files(dir.path()).unwrap();
        for (name, bundled) in bundled_runtime_files() {
            assert_eq!(
                fs::read_to_string(dir.path().join(name)).unwrap(),
                bundled,
                "{name} content must match the bundled source"
            );
        }
    }

    #[test]
    fn classify_file_matches_when_installed_equals_bundled() {
        let read: io::Result<String> = Ok(BUNDLED_HARNESS.to_string());
        assert_eq!(classify_file(&read, BUNDLED_HARNESS), FileIntegrity::Match);
    }

    #[test]
    fn classify_file_reports_drift_for_differing_content() {
        let read: io::Result<String> = Ok("stale harness".to_string());
        assert_eq!(classify_file(&read, BUNDLED_HARNESS), FileIntegrity::Drift);
    }

    #[test]
    fn classify_file_distinguishes_missing_from_unreadable() {
        let missing: io::Result<String> = Err(io::Error::from(io::ErrorKind::NotFound));
        assert_eq!(classify_file(&missing, "x"), FileIntegrity::Missing);

        let unreadable: io::Result<String> = Err(io::Error::from(io::ErrorKind::PermissionDenied));
        assert_eq!(classify_file(&unreadable, "x"), FileIntegrity::Unreadable);
    }

    #[test]
    fn heal_rewrites_drifted_file_to_bundled_content() {
        let dir = tempdir().unwrap();
        // Seed every file with bundled content, then drift one.
        write_runner_files(dir.path()).unwrap();
        fs::write(dir.path().join("query-classifier.js"), "// STALE").unwrap();

        let report = heal_runner_files(dir.path());

        assert!(report.healed.contains(&"query-classifier.js"));
        assert!(report.unreadable.is_empty());
        assert_eq!(
            fs::read_to_string(dir.path().join("query-classifier.js")).unwrap(),
            BUNDLED_QUERY_CLASSIFIER
        );
    }

    #[test]
    fn heal_writes_missing_file() {
        let dir = tempdir().unwrap();
        // Empty existing dir: every runtime file is missing and must be installed.
        let report = heal_runner_files(dir.path());

        for (name, bundled) in bundled_runtime_files() {
            assert!(report.healed.contains(&name), "{name} should have been healed");
            assert_eq!(fs::read_to_string(dir.path().join(name)).unwrap(), bundled);
        }
        assert!(report.unreadable.is_empty());
    }

    #[test]
    fn heal_is_noop_when_all_files_match() {
        let dir = tempdir().unwrap();
        write_runner_files(dir.path()).unwrap();

        let report = heal_runner_files(dir.path());

        assert!(report.healed.is_empty(), "nothing should be rewritten when in sync");
        assert!(report.unreadable.is_empty());
    }

    #[test]
    fn heal_warns_on_unreadable_file_without_panicking() {
        let dir = tempdir().unwrap();
        // A directory where redact.js should be makes read_to_string fail with a
        // non-NotFound error (and fs::write fail too) — must be left untouched.
        fs::create_dir(dir.path().join("redact.js")).unwrap();

        let report = heal_runner_files(dir.path());

        assert!(report.unreadable.contains(&"redact.js"));
        assert!(!report.healed.contains(&"redact.js"));
        assert!(dir.path().join("redact.js").is_dir(), "unreadable path must be left as-is");
    }

    #[test]
    fn fingerprint_is_stable_and_distinguishes_content() {
        assert_eq!(fingerprint("abc"), fingerprint("abc"));
        assert_ne!(fingerprint("abc"), fingerprint("abd"));
        assert_eq!(fingerprint("abc").len(), 16);
    }

    #[test]
    fn runner_package_json_includes_schema_dep() {
        assert!(
            RUNNER_PACKAGE_JSON.contains("mongodb-schema"),
            "runtime package.json must declare mongodb-schema so npm install pulls it"
        );
    }
}
