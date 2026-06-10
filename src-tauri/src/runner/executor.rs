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
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Unconditionally clear any MONGO_* auth vars inherited from the parent
    // process before (re-)setting them. Without this, a shell-level
    // MONGO_USER / MONGO_PASS present in the environment would silently carry
    // into a no-auth (AuthMode::None) connection and cause unexpected auth
    // attempts against the server. Clearing first ensures the runner's auth
    // comes exclusively from the credential we resolve at connect time.
    cmd.env_remove("MONGO_USER")
        .env_remove("MONGO_PASS")
        .env_remove("MONGO_AUTH_SOURCE")
        .env_remove("MONGO_AUTH_MECHANISM");

    // Inject auth env vars only when the connection uses a password-based
    // mechanism. Kept out of logs above to avoid leaking secrets.
    if let Some(credential) = cred {
        cmd.env("MONGO_USER", &credential.username);
        if let Some(password) = &credential.password {
            cmd.env("MONGO_PASS", password);
        }
        if let Some(auth_source) = &credential.auth_source {
            cmd.env("MONGO_AUTH_SOURCE", auth_source);
        }
        if let Some(mechanism) = &credential.mechanism {
            cmd.env("MONGO_AUTH_MECHANISM", mechanism);
        }
    }

    cmd.spawn().map_err(|e| {
        logger.error("spawn failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
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
/// Wiring: the cancel/timeout `child.kill()` call sites in
/// `crate::commands::script` must call this instead. Until that wiring lands the
/// fn is unreferenced in the binary build, hence the `allow(dead_code)`.
#[allow(dead_code)]
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
#[allow(dead_code)]
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
    const HARNESS: &str = include_str!("../../../runner/harness.js");
    const LOGGER_JS: &str = include_str!("../../../runner/logger.js");
    const REDACT_JS: &str = include_str!("../../../runner/redact.js");
    install_runner(HARNESS, LOGGER_JS, REDACT_JS)
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
}
