//! One long-lived harness process per connection.
//!
//! Replaces the spawn-a-child-per-query model: `connections_v2_connect`
//! spawns `node harness.js --serve <db>` once, and every `run_script` for
//! that connection writes an NDJSON `run` request to the child's stdin and
//! streams the tagged responses back off its stdout until a terminal
//! `__done` line. The process — and its single MongoClient — is reused for
//! the life of the connection and torn down on disconnect.
//!
//! Wire protocol (NDJSON, one JSON object per line; locked with the Node
//! side in `runner/harness.js`):
//!   * init:     we write `{"__init":{"auth":{...}}}` (or `{"__init":{}}`),
//!               the harness replies `{"__ready":true}` or
//!               `{"__error":"...","fatal":true}`.
//!   * run:      `{"id","action":"run","db","script","page","pageSize"}`
//!   * cancel:   `{"id","action":"cancel"}`
//!   * shutdown: `{"action":"shutdown"}`
//!   * responses each carry the request `id`; `{"id","__done":true}` is
//!     terminal per request.
//!
//! ponytail: one harness per connection, requests run serially inside it.
//! The demux map exists only so concurrent tabs route their responses
//! correctly — it is NOT a worker pool. Don't grow this into a process pool
//! or a worker-per-tab until real concurrent-tab load demands it.

use crate::logctx;
use crate::logger::Logger;
use crate::runner::{harness_path, RunnerCredential};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long to wait for the harness `__ready`/`__error` reply after sending
/// the init line. A live MongoClient connect within an existing tunnel is
/// fast; a hung connect should surface as a connect error, not block forever.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// One parsed response line from the harness, already demuxed to its request.
/// The raw JSON `Value` is forwarded as-is so the run loop can reuse the exact
/// same field-extraction the per-child model used (keeps `script-event` shape
/// identical for the frontend).
pub type HarnessResponse = serde_json::Value;

/// A live harness child process for one connection. Cheap to look up; the
/// expensive bits (child, reader thread) are owned behind `Arc`/`Mutex`.
///
/// Crash recovery: the stdout reader marks `alive=false` on EOF/exit, and
/// `send_run` returns an error once dead. `run_script` then respawns lazily.
pub struct HarnessHandle {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    /// reqId -> channel the reader forwards that request's response lines to.
    inflight: Arc<Mutex<HashMap<String, Sender<HarnessResponse>>>>,
    /// Cleared by the reader thread on EOF/exit. Checked before every write.
    alive: Arc<Mutex<bool>>,
}

#[derive(Serialize)]
struct InitAuth {
    username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "authSource")]
    auth_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "authMechanism")]
    auth_mechanism: Option<String>,
}

impl HarnessHandle {
    /// Spawn `node harness.js --serve <db>`, send the init line, and block
    /// (up to `READY_TIMEOUT`) for the harness to confirm its MongoClient is
    /// connected. On any failure the child is reaped before returning so a
    /// failed connect never leaks a zombie.
    ///
    /// `node` is the resolved node binary path (callers already resolve it via
    /// `executor::resolve_node`, threaded in to keep this module free of the
    /// login-shell lookup).
    pub fn spawn(
        node: &str,
        uri: &str,
        default_db: &str,
        logs_dir: &Path,
        level: &str,
        run_id: &str,
        cred: Option<&RunnerCredential>,
        logger: Arc<dyn Logger>,
    ) -> Result<Self, String> {
        // Deploy-by-copy guard: detect a stale installed harness once per process.
        crate::runner::executor::ensure_integrity_checked(logger.as_ref());
        // Credential fields are intentionally excluded from this log line —
        // passwords must never appear in log output.
        logger.info("spawn harness", logctx! {
            "node" => node,
            "harness" => harness_path().display().to_string(),
            "db" => default_db,
        });

        let mut cmd = Command::new(node);
        cmd.arg(harness_path())
            .arg("--serve")
            .arg(default_db)
            .env("MONGO_URI", uri)
            .env("MONGOMACAPP_RUN_ID", run_id)
            .env("MONGOMACAPP_LOGS_DIR", logs_dir.display().to_string())
            .env("MONGOMACAPP_LOG_LEVEL", level)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Defense-in-depth: credentials travel over stdin, never env vars (env
        // is readable by same-user processes via `ps -E`). Strip any inherited
        // MONGO_* auth vars so a stray shell value can't leak in.
        cmd.env_remove("MONGO_USER")
            .env_remove("MONGO_PASS")
            .env_remove("MONGO_AUTH_SOURCE")
            .env_remove("MONGO_AUTH_MECHANISM");

        let child = cmd.spawn().map_err(|e| {
            logger.error("harness spawn failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?;

        Self::from_child(child, cred, default_db, logger)
    }

    /// Wire a freshly-spawned child into a `HarnessHandle`: take its pipes,
    /// start the reader threads, send the init line, and block for the
    /// `__ready`/`__error` reply. Split out of `spawn` so lifecycle tests can
    /// inject a mock child that speaks the protocol without node or Mongo.
    fn from_child(
        mut child: Child,
        cred: Option<&RunnerCredential>,
        default_db: &str,
        logger: Arc<dyn Logger>,
    ) -> Result<Self, String> {
        let stdin = child.stdin.take().ok_or("harness: no stdin")?;
        let stdout = child.stdout.take().ok_or("harness: no stdout")?;
        let stderr = child.stderr.take().ok_or("harness: no stderr")?;

        let inflight: Arc<Mutex<HashMap<String, Sender<HarnessResponse>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(Mutex::new(true));

        // The init handshake needs the ready/error reply before any request is
        // in flight, so it can't go through the per-request demux map. Register
        // a reserved channel under the empty id "" for it; the reader routes
        // the `__ready`/`__error` (which carry no request id) there.
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<HarnessResponse>();
        inflight.lock().unwrap().insert(String::new(), ready_tx);

        spawn_stdout_reader(stdout, inflight.clone(), alive.clone(), logger.clone());
        spawn_stderr_logger(stderr, logger.clone());

        let handle = HarnessHandle {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            inflight,
            alive,
        };

        if let Err(e) = handle.write_init(cred) {
            handle.kill_now();
            return Err(format!("harness init write failed: {e}"));
        }

        // Block for the harness to confirm connect. The reader thread forwards
        // the `__ready`/`__error` line to `ready_rx`.
        let ready = ready_rx.recv_timeout(READY_TIMEOUT);
        handle.inflight.lock().unwrap().remove("");
        match ready {
            Ok(line) if line.get("__ready").and_then(|v| v.as_bool()) == Some(true) => {
                logger.info("harness ready", logctx! { "db" => default_db });
                Ok(handle)
            }
            Ok(line) => {
                let msg = line
                    .get("__error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("harness reported a fatal error during connect")
                    .to_string();
                logger.error("harness init failed", logctx! { "err" => msg.clone() });
                handle.kill_now();
                Err(msg)
            }
            Err(_) => {
                logger.error("harness init timed out", logctx! {
                    "timeoutSecs" => READY_TIMEOUT.as_secs(),
                });
                handle.kill_now();
                Err("harness did not become ready (timed out)".to_string())
            }
        }
    }

    /// Build and write the `__init` line. With no credential we still write
    /// `{"__init":{}}` so the harness proceeds on the URI-embedded / no-auth
    /// path rather than blocking on a never-arriving line.
    fn write_init(&self, cred: Option<&RunnerCredential>) -> std::io::Result<()> {
        let payload = match cred {
            Some(c) => serde_json::json!({
                "__init": {
                    "auth": InitAuth {
                        username: c.username.clone(),
                        password: c.password.clone(),
                        auth_source: c.auth_source.clone(),
                        auth_mechanism: c.mechanism.clone(),
                    }
                }
            }),
            None => serde_json::json!({ "__init": {} }),
        };
        self.write_line(&payload.to_string())
    }

    /// Register a response channel for `req_id`, write the `run` request, and
    /// return the receiver the caller drains until `__done`. The channel is
    /// removed from the demux map by `finish_request` (called by the run loop)
    /// — not here — so a late line can't hit a missing entry mid-stream.
    pub fn send_run(
        &self,
        req_id: &str,
        db: &str,
        script: &str,
        page: u32,
        page_size: u32,
    ) -> Result<Receiver<HarnessResponse>, String> {
        if !self.is_alive() {
            return Err("harness process is not running".to_string());
        }
        let (tx, rx) = std::sync::mpsc::channel::<HarnessResponse>();
        self.inflight.lock().unwrap().insert(req_id.to_string(), tx);

        let req = serde_json::json!({
            "id": req_id,
            "action": "run",
            "db": db,
            "script": script,
            "page": page,
            "pageSize": page_size,
        });
        if let Err(e) = self.write_line(&req.to_string()) {
            self.inflight.lock().unwrap().remove(req_id);
            return Err(format!("harness write failed: {e}"));
        }
        Ok(rx)
    }

    /// Send a cancel frame for an in-flight request. The harness stops the run
    /// and still emits a terminal `__done` for `req_id`, so the run loop
    /// resolves normally — we do NOT kill the process (that's the whole point
    /// of the persistent model).
    pub fn send_cancel(&self, req_id: &str) -> Result<(), String> {
        if !self.is_alive() {
            return Err("harness process is not running".to_string());
        }
        let req = serde_json::json!({ "id": req_id, "action": "cancel" });
        self.write_line(&req.to_string())
            .map_err(|e| format!("harness cancel write failed: {e}"))
    }

    /// Drop the demux entry for a finished request. Called by the run loop once
    /// it sees `__done` (or the channel closes on a dead harness).
    pub fn finish_request(&self, req_id: &str) {
        self.inflight.lock().unwrap().remove(req_id);
    }

    /// Ask the harness to shut down gracefully, then reap it within a grace
    /// window (SIGKILL + wait if it overstays). Used on disconnect / app exit.
    pub fn shutdown(&self, grace: Duration, logger: &dyn Logger) {
        if self.is_alive() {
            let _ = self.write_line(&serde_json::json!({ "action": "shutdown" }).to_string());
        }
        let deadline = Instant::now() + grace;
        let mut child = self.child.lock().unwrap();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    logger.debug("harness exited on shutdown", logctx! {});
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
        logger.warn("harness did not exit on shutdown — killing", logctx! {});
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Whether the harness child is still running. Cleared by the stdout
    /// reader on EOF/exit. A dead handle must be replaced (lazy respawn in
    /// `run_script`) — its stdin writes will fail and no responses will arrive.
    pub fn is_alive(&self) -> bool {
        *self.alive.lock().unwrap()
    }

    /// OS pid of the harness child. Test-only: lifecycle tests assert that two
    /// sequential runs hit the SAME pid (one reused process, no respawn).
    #[cfg(test)]
    pub(crate) fn pid(&self) -> u32 {
        self.child.lock().unwrap().id()
    }

    fn write_line(&self, line: &str) -> std::io::Result<()> {
        let mut stdin = self.stdin.lock().unwrap();
        stdin.write_all(line.as_bytes())?;
        stdin.write_all(b"\n")?;
        stdin.flush()
    }

    /// Hard-kill + reap, used only on the spawn failure paths where there is no
    /// point asking a not-yet-ready harness to shut down gracefully.
    fn kill_now(&self) {
        let mut child = self.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Read harness stdout line-by-line, demux each parsed line to the channel for
/// its request `id`, and forward. `__ready`/`__error` init replies carry no
/// `id`, so they route to the reserved empty-id channel. On EOF/exit the
/// harness is marked dead and every pending channel is dropped (closing it), so
/// a run loop blocked on `recv()` unblocks instead of hanging forever.
fn spawn_stdout_reader(
    stdout: std::process::ChildStdout,
    inflight: Arc<Mutex<HashMap<String, Sender<HarnessResponse>>>>,
    alive: Arc<Mutex<bool>>,
    logger: Arc<dyn Logger>,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let value: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue, // non-JSON stdout noise — ignore
            };
            // Init replies (`__ready`/`__error` with fatal) carry no request
            // id; route them to the reserved "" channel.
            let is_init_reply = value.get("__ready").is_some()
                || (value.get("__error").is_some() && value.get("id").is_none());
            let key = if is_init_reply {
                String::new()
            } else {
                match value.get("id").and_then(|v| v.as_str()) {
                    Some(id) => id.to_string(),
                    None => continue, // tagged line with no id — can't route
                }
            };
            let sender = inflight.lock().unwrap().get(&key).cloned();
            if let Some(tx) = sender {
                // Receiver gone (run loop already finished) — drop the line.
                let _ = tx.send(value);
            }
        }
        // EOF: harness stdout closed -> process is exiting. Mark dead and drop
        // every pending sender so blocked run loops see their channel close.
        *alive.lock().unwrap() = false;
        inflight.lock().unwrap().clear();
        logger.warn("harness stdout closed — process exited", logctx! {});
    });
}

/// Drain harness stderr into the backend log. Stderr stays process-level
/// (un-tagged by request id), same as the per-child model — `__debug` lines
/// are diagnostics. Errors that matter to a specific run arrive on stdout as
/// id-tagged `__error` lines instead.
fn spawn_stderr_logger(stderr: std::process::ChildStderr, logger: Arc<dyn Logger>) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(msg) = v.get("__debug").and_then(|x| x.as_str()) {
                    logger.debug(msg, logctx! {});
                    continue;
                }
            }
            logger.debug("harness stderr", logctx! { "line" => line });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::MemoryLogger;
    use std::os::unix::fs::PermissionsExt;

    fn null_logger() -> Arc<dyn Logger> {
        MemoryLogger::new("harness-test")
    }

    /// A node-free mock harness that speaks the wire protocol just enough to
    /// exercise the Rust lifecycle: `__init`→`__ready`, one group + terminal
    /// `__done` per `run` (echoing the request id), a marker line on `cancel`,
    /// and exit on `shutdown`. `cancel_marker` records that a cancel FRAME was
    /// received — the lifecycle assertion that cancel does not kill the process.
    fn mock_harness_script(cancel_marker: &Path) -> tempfile::NamedTempFile {
        let marker = cancel_marker.display();
        let body = format!(
            r#"#!/bin/bash
while IFS= read -r line; do
  case "$line" in
    *'"__init"'*) echo '{{"__ready":true}}' ;;
    *'"action":"run"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
      echo "{{\"id\":\"$id\",\"__group\":0,\"docs\":[]}}"
      echo "{{\"id\":\"$id\",\"__done\":true}}"
      ;;
    *'"action":"cancel"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
      echo "cancel:$id" >> "{marker}"
      echo "{{\"id\":\"$id\",\"__done\":true}}"
      ;;
    *'"action":"shutdown"'*) exit 0 ;;
  esac
done
"#
        );
        let mut file = tempfile::Builder::new()
            .prefix("mock-harness-")
            .suffix(".sh")
            .tempfile()
            .unwrap();
        file.write_all(body.as_bytes()).unwrap();
        file.flush().unwrap();
        std::fs::set_permissions(file.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        file
    }

    /// Spawn the mock harness as a child wired through `from_child`, so the test
    /// drives the real demux/handshake code without node or Mongo.
    fn spawn_mock(script: &Path) -> HarnessHandle {
        let child = Command::new("/bin/bash")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        HarnessHandle::from_child(child, None, "admin", null_logger()).expect("mock becomes ready")
    }

    fn drain_to_done(rx: &Receiver<HarnessResponse>) {
        loop {
            let line = rx
                .recv_timeout(Duration::from_secs(5))
                .expect("response before timeout");
            if line.get("__done").and_then(|v| v.as_bool()) == Some(true) {
                return;
            }
        }
    }

    #[test]
    fn connect_spawns_one_process_and_two_runs_reuse_it() {
        let marker = tempfile::NamedTempFile::new().unwrap();
        let script = mock_harness_script(marker.path());
        let handle = spawn_mock(script.path());

        // One process exists after connect.
        let pid = handle.pid();
        assert!(handle.is_alive(), "handle must be alive after ready");

        // Two sequential runs reuse the SAME process — no respawn.
        let rx1 = handle.send_run("req-1", "db", "db.c.find({})", 0, 50).unwrap();
        drain_to_done(&rx1);
        handle.finish_request("req-1");
        assert_eq!(handle.pid(), pid, "first run must reuse the process");

        let rx2 = handle.send_run("req-2", "db", "db.c.find({})", 0, 50).unwrap();
        drain_to_done(&rx2);
        handle.finish_request("req-2");
        assert_eq!(handle.pid(), pid, "second run must reuse the SAME process");
        assert!(handle.is_alive(), "process stays alive between runs");

        handle.shutdown(Duration::from_secs(2), &*null_logger());
    }

    #[test]
    fn responses_demux_by_request_id() {
        let marker = tempfile::NamedTempFile::new().unwrap();
        let script = mock_harness_script(marker.path());
        let handle = spawn_mock(script.path());

        // Two runs: each receiver must see ONLY its own id's lines.
        let rx_a = handle.send_run("AAA", "db", "s", 0, 50).unwrap();
        let first = rx_a.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(first.get("id").and_then(|v| v.as_str()), Some("AAA"));
        drain_to_done(&rx_a);
        handle.finish_request("AAA");

        let rx_b = handle.send_run("BBB", "db", "s", 0, 50).unwrap();
        let first_b = rx_b.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(first_b.get("id").and_then(|v| v.as_str()), Some("BBB"));
        drain_to_done(&rx_b);
        handle.finish_request("BBB");

        handle.shutdown(Duration::from_secs(2), &*null_logger());
    }

    #[test]
    fn cancel_sends_a_frame_and_does_not_kill_the_process() {
        let marker = tempfile::NamedTempFile::new().unwrap();
        let script = mock_harness_script(marker.path());
        let handle = spawn_mock(script.path());
        let pid = handle.pid();

        handle.send_cancel("req-x").unwrap();
        // The cancel frame reached the harness (it appended to the marker file),
        // and the process is still alive — cancel is a frame, not a kill.
        let mut saw_cancel = false;
        for _ in 0..50 {
            if std::fs::read_to_string(marker.path())
                .map(|s| s.contains("cancel:req-x"))
                .unwrap_or(false)
            {
                saw_cancel = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(saw_cancel, "harness must receive the cancel frame");
        assert!(handle.is_alive(), "cancel must NOT kill the process");
        assert_eq!(handle.pid(), pid, "same process after cancel");

        handle.shutdown(Duration::from_secs(2), &*null_logger());
    }

    #[test]
    fn shutdown_tears_the_process_down() {
        let marker = tempfile::NamedTempFile::new().unwrap();
        let script = mock_harness_script(marker.path());
        let handle = spawn_mock(script.path());
        assert!(handle.is_alive());

        handle.shutdown(Duration::from_secs(2), &*null_logger());

        // After shutdown the child is reaped: try_wait returns the exit status
        // immediately (no zombie, no still-running process).
        let reaped = handle.child.lock().unwrap().try_wait().unwrap();
        assert!(reaped.is_some(), "child must be reaped after shutdown");
    }

    #[test]
    fn dead_harness_rejects_runs() {
        let marker = tempfile::NamedTempFile::new().unwrap();
        let script = mock_harness_script(marker.path());
        let handle = spawn_mock(script.path());
        handle.shutdown(Duration::from_secs(2), &*null_logger());

        // The stdout reader marks the handle dead on EOF; give it a beat.
        for _ in 0..50 {
            if !handle.is_alive() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!handle.is_alive(), "handle is dead after shutdown");
        assert!(
            handle.send_run("late", "db", "s", 0, 50).is_err(),
            "a dead harness must reject new runs so run_script respawns"
        );
    }
}
