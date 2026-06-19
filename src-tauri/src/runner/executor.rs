use crate::logctx;
use crate::logger::Logger;
use crate::runner::{harness_path, node_modules_dir, runner_dir};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

static NODE_PATH: OnceLock<String> = OnceLock::new();

/// Bundled runner harness source, embedded at build time. The deploy-by-copy
/// guard compares this against the installed `~/.mongomacapp/runner/harness.js`
/// so a stale install (edited source never redeployed, or stale binary) is
/// detected instead of silently running divergent code.
const BUNDLED_HARNESS: &str = include_str!("../../../runner/harness.js");

// Run the integrity check at most once per process.
static INTEGRITY_CHECKED: OnceLock<()> = OnceLock::new();

/// Deploy-by-copy guard, run at most once per process. Public to the crate so
/// the persistent-harness spawn path (`runner::harness`) triggers the same
/// stale-install warning the legacy per-child spawn did.
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
        Command::new("/bin/zsh")
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
    let installed = node_modules_dir().join("mongodb").is_dir();
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

/// Write the harness and its sibling runtime modules to `dir`, plus a fresh
/// `package.json` describing the runner's npm deps. Pure file-system work so
/// it can be unit-tested against a tempdir without invoking npm.
///
/// Bundles every JS file the harness `require`s at runtime:
///   - `harness.js`  — entry point spawned by `runner::harness::HarnessHandle`
///   - `logger.js`   — required by harness.js
///   - `redact.js`   — required by logger.js
///
/// To add a new runtime sibling: drop it as a new `&str` arg, write it
/// alongside the existing files, and pass the corresponding `include_str!`
/// from `install_node_runner`. No other code changes needed.
fn write_runner_files(
    dir: &std::path::Path,
    harness: &str,
    logger_js: &str,
    redact_js: &str,
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("harness.js"), harness).map_err(|e| e.to_string())?;
    fs::write(dir.join("logger.js"), logger_js).map_err(|e| e.to_string())?;
    fs::write(dir.join("redact.js"), redact_js).map_err(|e| e.to_string())?;
    let pkg = r#"{"name":"mongomacapp-runner","version":"1.0.0","dependencies":{"mongodb":"^6.8.0"}}"#;
    fs::write(dir.join("package.json"), pkg).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn install_runner(
    bundled_harness: &str,
    bundled_logger: &str,
    bundled_redact: &str,
) -> Result<(), String> {
    let dir = runner_dir();
    write_runner_files(&dir, bundled_harness, bundled_logger, bundled_redact)?;
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
    const LOGGER_JS: &str = include_str!("../../../runner/logger.js");
    const REDACT_JS: &str = include_str!("../../../runner/redact.js");
    install_runner(BUNDLED_HARNESS, LOGGER_JS, REDACT_JS)
}

#[derive(PartialEq, Debug)]
enum HarnessIntegrity {
    Match,
    Drift,
    Unreadable,
}

fn check_harness_integrity(installed: Option<&str>) -> HarnessIntegrity {
    match installed {
        Some(content) if content == BUNDLED_HARNESS => HarnessIntegrity::Match,
        Some(_) => HarnessIntegrity::Drift,
        None => HarnessIntegrity::Unreadable,
    }
}

// FNV-1a 64-bit — dependency-free short content fingerprint for log lines, so a
// drift warning carries a comparable id without dumping whole files.
fn fingerprint(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Deploy-by-copy guard: warn loudly when the installed harness diverges from
/// the bundled source. Run once per process (subsequent calls are no-ops).
fn verify_runner_integrity(logger: &dyn Logger) {
    let path = harness_path();
    let installed = fs::read_to_string(&path).ok();
    match check_harness_integrity(installed.as_deref()) {
        HarnessIntegrity::Match => logger.debug("runner integrity ok", logctx! {
            "fingerprint" => fingerprint(BUNDLED_HARNESS),
        }),
        HarnessIntegrity::Drift => logger.warn(
            "RUNNER OUT OF DATE — installed harness.js differs from the bundled source. \
             Run install_node_runner or `cp runner/harness.js ~/.mongomacapp/runner/harness.js`.",
            logctx! {
                "installed" => path.display().to_string(),
                "installedFingerprint" => fingerprint(installed.as_deref().unwrap_or("")),
                "bundledFingerprint" => fingerprint(BUNDLED_HARNESS),
            },
        ),
        HarnessIntegrity::Unreadable => logger.warn(
            "runner integrity check skipped — installed harness.js is unreadable",
            logctx! { "installed" => path.display().to_string() },
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_runner_files_creates_required_runtime_files() {
        // Regression test for B-1: a clean install must produce every JS file
        // the harness requires at runtime, not just harness.js.
        let d = tempdir().unwrap();
        write_runner_files(d.path(), "/* harness */", "/* logger */", "/* redact */")
            .unwrap();
        for required in ["harness.js", "logger.js", "redact.js", "package.json"] {
            assert!(
                d.path().join(required).is_file(),
                "expected {required} to be written into runner dir"
            );
        }
    }

    #[test]
    fn write_runner_files_writes_exact_content() {
        let d = tempdir().unwrap();
        write_runner_files(d.path(), "H", "L", "R").unwrap();
        assert_eq!(fs::read_to_string(d.path().join("harness.js")).unwrap(), "H");
        assert_eq!(fs::read_to_string(d.path().join("logger.js")).unwrap(), "L");
        assert_eq!(fs::read_to_string(d.path().join("redact.js")).unwrap(), "R");
    }

    #[test]
    fn integrity_matches_when_installed_equals_bundled() {
        assert_eq!(
            check_harness_integrity(Some(BUNDLED_HARNESS)),
            HarnessIntegrity::Match
        );
    }

    #[test]
    fn integrity_reports_drift_and_unreadable() {
        assert_eq!(
            check_harness_integrity(Some("stale harness")),
            HarnessIntegrity::Drift
        );
        assert_eq!(check_harness_integrity(None), HarnessIntegrity::Unreadable);
    }

    #[test]
    fn fingerprint_is_stable_and_distinguishes_content() {
        assert_eq!(fingerprint("abc"), fingerprint("abc"));
        assert_ne!(fingerprint("abc"), fingerprint("abd"));
        assert_eq!(fingerprint("abc").len(), 16);
    }
}
