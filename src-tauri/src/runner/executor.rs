use crate::logctx;
use crate::logger::Logger;
use crate::runner::{harness_path, node_modules_dir, runner_dir};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

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

pub fn install_runner(bundled_harness: &str) -> Result<(), String> {
    let dir = runner_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(harness_path(), bundled_harness).map_err(|e| e.to_string())?;
    let pkg = r#"{"name":"mongomacapp-runner","version":"1.0.0","dependencies":{"mongodb":"^6.8.0"}}"#;
    fs::write(dir.join("package.json"), pkg).map_err(|e| e.to_string())?;
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
) -> Result<std::process::Child, String> {
    let node = resolve_node().ok_or("Node.js not found — check node installation")?;
    logger.info("spawn runner", logctx! {
        "node" => node,
        "harness" => harness_path().display().to_string(),
        "db" => database,
        "page" => page,
        "pageSize" => page_size,
        "runId" => run_id,
    });
    // Spawn node directly (not via shell) to avoid login-shell startup noise on stderr
    Command::new(node)
        .arg(harness_path())
        .arg(database)
        .arg(script_path)
        .env("MONGO_URI", uri)
        .env("MONGO_PAGE", page.to_string())
        .env("MONGO_PAGE_SIZE", page_size.to_string())
        .env("MONGOMACAPP_RUN_ID", run_id)
        .env("MONGOMACAPP_LOGS_DIR", logs_dir.display().to_string())
        .env("MONGOMACAPP_LOG_LEVEL", level)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            logger.error("spawn failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })
}

#[tauri::command]
pub fn check_node_runner() -> RunnerStatus {
    check_runner()
}

#[tauri::command]
pub fn install_node_runner() -> Result<(), String> {
    const HARNESS: &str = include_str!("../../../runner/harness.js");
    install_runner(HARNESS)
}
