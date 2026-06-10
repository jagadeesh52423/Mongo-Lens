use crate::logctx;
use crate::logger::Logger;
use crate::runner::{harness_path, node_modules_dir, runner_dir, RunnerCredential};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

static NODE_PATH: OnceLock<String> = OnceLock::new();

/// Bundled runner harness source, embedded at build time. The deploy-by-copy
/// guard compares this against the installed `~/.mongomacapp/runner/harness.js`
/// so a stale install (edited source never redeployed, or stale binary) is
/// detected instead of silently running divergent code.
const BUNDLED_HARNESS: &str = include_str!("../../../runner/harness.js");

// Run the integrity check at most once per process.
static INTEGRITY_CHECKED: OnceLock<()> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatus {
    pub ready: bool,
    pub node_version: Option<String>,
    pub message: Option<String>,
}

/// Resolve node binary path via login shell once, cache in NODE_PATH.
fn resolve_node() -> Option<&'static str> {
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
///   - `harness.js`  — entry point launched by `spawn_script`
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

pub fn spawn_script(
    uri: &str,
    database: &str,
    script_path: &Path,
    page: u32,
    page_size: u32,
    run_id: &str,
    logs_dir: &Path,
    level: &str,
    logger: Arc<dyn Logger>,
    cred: Option<&RunnerCredential>,
) -> Result<std::process::Child, String> {
    let node = resolve_node().ok_or("Node.js not found — check node installation")?;
    // Deploy-by-copy guard: detect a stale installed harness once per process.
    INTEGRITY_CHECKED.get_or_init(|| verify_runner_integrity(logger.as_ref()));
    // Credential fields are intentionally excluded from this log line —
    // passwords must never appear in log output.
    logger.info("spawn runner", logctx! {
        "node" => node,
        "harness" => harness_path().display().to_string(),
        "db" => database,
        "page" => page,
        "pageSize" => page_size,
        "runId" => run_id,
    });
    // Spawn node directly (not via shell) to avoid login-shell startup noise on stderr
    let mut cmd = Command::new(node);
    cmd.arg(harness_path())
        .arg(database)
        .arg(script_path)
        .env("MONGO_URI", uri)
        .env("MONGO_PAGE", page.to_string())
        .env("MONGO_PAGE_SIZE", page_size.to_string())
        .env("MONGOMACAPP_RUN_ID", run_id)
        .env("MONGOMACAPP_LOGS_DIR", logs_dir.display().to_string())
        .env("MONGOMACAPP_LOG_LEVEL", level)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Defense-in-depth: credentials now travel over stdin, never env vars (env
    // is readable by same-user processes via `ps -E` / proc inspection). Strip
    // any inherited MONGO_* auth vars so a stray shell value can't leak in.
    cmd.env_remove("MONGO_USER")
        .env_remove("MONGO_PASS")
        .env_remove("MONGO_AUTH_SOURCE")
        .env_remove("MONGO_AUTH_MECHANISM");

    let mut child = cmd.spawn().map_err(|e| {
        logger.error("spawn failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    // Hand the credential to the harness as one JSON line on stdin, then close
    // stdin so its blocking read sees EOF. The payload is tiny (well under the
    // pipe buffer) so write_all cannot deadlock. With no credential we still
    // close stdin so the harness read returns empty and falls back to the
    // URI-embedded / no-auth path.
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(credential) = cred {
            use std::io::Write;
            let line = serde_json::json!({
                "username": credential.username,
                "password": credential.password,
                "authSource": credential.auth_source,
                "authMechanism": credential.mechanism,
            })
            .to_string();
            if let Err(e) = stdin
                .write_all(line.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
            {
                logger.error("write runner credentials failed", logctx! { "err" => e.to_string() });
            }
        }
        // stdin dropped here -> closed.
    }
    Ok(child)
}

/// Default grace window between SIGTERM and SIGKILL when terminating a runner
/// child. Overridable via MONGOMACAPP_KILL_GRACE_MS to tune without a rebuild.
const DEFAULT_KILL_GRACE_MS: u64 = 750;

fn kill_grace() -> Duration {
    std::env::var("MONGOMACAPP_KILL_GRACE_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or(Duration::from_millis(DEFAULT_KILL_GRACE_MS))
}

/// Terminate a runner child gracefully. std `Child::kill()` only sends SIGKILL,
/// which bypasses the harness SIGTERM handler (runner/harness.js) and leaves the
/// server-side Mongo connection dangling — stale connections then accumulate
/// across repeated cancels. Instead: send SIGTERM so the harness can close its
/// client, wait up to the grace window, then SIGKILL + reap if still alive.
/// Always reaps the child. Returns true when SIGTERM alone was sufficient.
///
/// Called by the cancel/timeout paths in `crate::commands::script`.
pub fn terminate_child(child: &mut Child) -> bool {
    send_sigterm(child.id());
    let deadline = Instant::now() + kill_grace();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    false
}

// std has no portable signal API and the project pulls in no libc/nix crate, so
// shell out to /bin/kill (always present on macOS, the only supported target)
// to deliver SIGTERM.
fn send_sigterm(pid: u32) {
    let _ = Command::new("/bin/kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status();
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
    fn terminate_child_sigterms_a_running_process_within_grace() {
        // /bin/sleep terminates on SIGTERM's default action, so terminate_child
        // should reap it via the graceful path (no SIGKILL needed).
        let mut child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let graceful = terminate_child(&mut child);
        assert!(graceful, "sleep should exit from SIGTERM within the grace window");
    }

    #[test]
    fn kill_grace_falls_back_to_default_when_env_unset() {
        std::env::remove_var("MONGOMACAPP_KILL_GRACE_MS");
        assert_eq!(kill_grace(), Duration::from_millis(DEFAULT_KILL_GRACE_MS));
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
