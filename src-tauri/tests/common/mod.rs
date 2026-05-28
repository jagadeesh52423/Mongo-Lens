//! Test infrastructure for `integration_connection.rs`.
//!
//! All containers launched here are labeled `conn-v2-test=1` so the
//! final sweep at the end of the test binary catches any survivors.
//! `ContainerGuard`'s Drop impl handles the normal panic-cleanup path.

#![allow(dead_code)] // Several helpers are used from a single test file each;
                    // suppress the "unused" noise across the crate.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use mongo_lens::connection::model::{
    AuthMode, Connection, ConnectionTarget, KnownHostsPolicy, Proxy, ProxyKind, ScramMechanism,
    SshAuth, SshTunnel, Tls,
};
use mongo_lens::logger::{Layer, Level, LogCtx, LogRecord, Logger};
use mongo_lens::prefs::model::EffectivePrefs;

/// Drop-on-the-floor logger. `MemoryLogger` in the lib is `#[cfg(test)]`
/// gated so it's invisible to integration tests; we ship a minimal stand-in
/// here. The builder only ever emits `info`/`warn`, so capturing nothing
/// is fine for end-to-end assertions.
struct NullLogger {
    name: String,
    bindings: LogCtx,
}

impl Logger for NullLogger {
    fn log(&self, _record: LogRecord) {}
    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger> {
        let mut merged = self.bindings.clone();
        merged.extend(bindings);
        Arc::new(NullLogger {
            name: self.name.clone(),
            bindings: merged,
        })
    }
    fn name(&self) -> &str { &self.name }
    fn threshold(&self) -> Level { Level::Error }
    fn bindings(&self) -> &LogCtx { &self.bindings }
    fn layer(&self) -> Layer { Layer::Backend }
}

/// Returns true iff the test runner asked for integration tests.
pub fn is_integration() -> bool {
    std::env::var("INTEGRATION").is_ok()
}

/// Common container label so the final sweep can find them.
pub const TEST_LABEL: &str = "conn-v2-test=1";

/// Generate a unique container name with a known prefix.
pub fn unique_name(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}

/// Wrap a logger constructor — every test takes one.
pub fn null_log() -> Arc<dyn Logger> {
    Arc::new(NullLogger {
        name: "integration".into(),
        bindings: LogCtx::new(),
    })
}

/// Default effective prefs — short timeouts so a wedged connection
/// fails fast instead of hanging the test suite.
pub fn fast_prefs() -> EffectivePrefs {
    let mut e = EffectivePrefs::default();
    e.advanced.server_selection_timeout_ms = 10_000;
    e.advanced.connect_timeout_ms = 5_000;
    e
}

// ──────────────────────────────────────────────────────────────────────────
// Docker shell-out
// ──────────────────────────────────────────────────────────────────────────

/// Run a docker subcommand with a hard timeout, capturing stdout+stderr.
/// `args` is everything *after* the literal `docker`. Returns trimmed stdout
/// on success; stderr included in the error on failure.
pub fn run_docker(args: &[&str]) -> Result<String, String> {
    run_with_timeout("docker", args, Duration::from_secs(60))
}

/// Same shape as `run_docker` but for arbitrary binaries (openssl,
/// ssh-keygen). Used by the per-test cert / keypair generation.
pub fn run_with_timeout(bin: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    // Spawn + wait-with-timeout via std (no wait_timeout dep). Loop polling
    // with 50ms granularity — coarse enough not to burn CPU, fine enough for
    // sub-second hops.
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn `{bin} {}` failed: {e}", args.join(" ")))?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = child.wait_with_output().map_err(|e| e.to_string())?;
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if status.success() {
                    return Ok(stdout);
                }
                return Err(format!(
                    "`{bin} {}` exited {:?}\nstdout: {stdout}\nstderr: {stderr}",
                    args.join(" "),
                    status.code(),
                ));
            }
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "`{bin} {}` timed out after {}s",
                        args.join(" "),
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("`{bin}` try_wait failed: {e}")),
        }
    }
}

/// Parse the host port `docker port <name> <internal>/tcp` returned for the
/// IPv4 mapping. Output line shape: `0.0.0.0:54321` (or sometimes
/// `[::]:54321\n0.0.0.0:54321`).
pub fn assigned_port(container: &str, internal: u16) -> Result<u16, String> {
    let spec = format!("{internal}/tcp");
    let out = run_docker(&["port", container, &spec])?;
    out.lines()
        .filter_map(|line| {
            let line = line.trim();
            // Prefer the IPv4 mapping; fall back to whichever's first.
            if line.starts_with("0.0.0.0:") || line.starts_with("127.0.0.1:") {
                Some(line)
            } else {
                None
            }
        })
        .next()
        .or_else(|| out.lines().next().map(str::trim))
        .ok_or_else(|| format!("docker port returned nothing for {container}:{internal}"))?
        .rsplit(':')
        .next()
        .and_then(|p| p.parse().ok())
        .ok_or_else(|| format!("could not parse port from `{out}`"))
}

/// Wait for `127.0.0.1:port` to accept a TCP connection. Used as a
/// cheap "container is up" probe before any MongoDB-level traffic.
pub async fn wait_for_tcp(host: &str, port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match tokio::net::TcpStream::connect((host, port)).await {
            Ok(_) => return Ok(()),
            Err(_) => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }
    Err(format!("tcp {host}:{port} never came up within {timeout:?}"))
}

/// `linuxserver/openssh-server` ships with `AllowTcpForwarding no` in its
/// generated /config/sshd/sshd_config — which blocks the whole point of
/// our SSH tunnel tests. Flip it on and HUP sshd. Idempotent.
pub fn enable_ssh_tcp_forwarding(container: &str) -> Result<(), String> {
    // The container's init writes /config/sshd/sshd_config from env vars on
    // first start, so give it a couple of seconds before we sed it.
    std::thread::sleep(Duration::from_secs(2));
    run_with_timeout(
        "docker",
        &[
            "exec", container,
            "sh", "-c",
            "sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /config/sshd/sshd_config && pkill -HUP sshd.pam",
        ],
        Duration::from_secs(10),
    )?;
    Ok(())
}

/// Poll the mongod inside `container_name` via `mongosh --eval "db.runCommand({ping:1})"`
/// until it returns success or `timeout` elapses. mongod accepts TCP well
/// before it's ready to authenticate, so a TCP probe alone isn't enough.
pub fn wait_for_mongo_ready_in_container(
    container: &str,
    extra_args: &[&str],
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_err = String::new();
    while Instant::now() < deadline {
        let mut args = vec!["exec", container, "mongosh", "--quiet", "--eval"];
        args.push("db.runCommand({ping:1}).ok");
        args.extend_from_slice(extra_args);
        match run_with_timeout("docker", &args, Duration::from_secs(10)) {
            Ok(out) if out.contains('1') => return Ok(()),
            Ok(out) => last_err = format!("ping returned: {out}"),
            Err(e) => last_err = e,
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(format!(
        "mongod in {container} never accepted ping within {timeout:?} — last: {last_err}"
    ))
}

// ──────────────────────────────────────────────────────────────────────────
// Container guards — Drop-driven cleanup
// ──────────────────────────────────────────────────────────────────────────

/// RAII wrapper. Drop calls `docker rm -f` synchronously and ignores errors.
/// Containers must be labeled `TEST_LABEL` so the post-suite sweep can
/// catch leaks.
pub struct ContainerGuard {
    pub name: String,
}

impl ContainerGuard {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }
}

impl Drop for ContainerGuard {
    fn drop(&mut self) {
        // Best-effort. 10s timeout because a hung docker daemon shouldn't
        // wedge test teardown — orphan containers will be reaped by the
        // final sweep.
        let _ = run_with_timeout(
            "docker",
            &["rm", "-f", &self.name],
            Duration::from_secs(10),
        );
    }
}

/// RAII wrapper for `docker network`. Drop removes the network. Tests that
/// need one (SSH tunnel, SOCKS5) create it first and pass `--network` to
/// every container.
pub struct NetworkGuard {
    pub name: String,
}

impl NetworkGuard {
    pub fn create(prefix: &str) -> Result<Self, String> {
        let name = unique_name(prefix);
        run_docker(&[
            "network",
            "create",
            "--label",
            TEST_LABEL,
            &name,
        ])?;
        Ok(Self { name })
    }
}

impl Drop for NetworkGuard {
    fn drop(&mut self) {
        let _ = run_with_timeout(
            "docker",
            &["network", "rm", &self.name],
            Duration::from_secs(10),
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TLS cert generation — openssl shell-out
// ──────────────────────────────────────────────────────────────────────────

/// Triplet of paths produced by `generate_tls_assets`. All sit inside the
/// caller's tempdir; the CA file is the trust anchor the client passes to
/// the mongodb driver, the combined PEM is what mongod mounts as
/// `--tlsCertificateKeyFile`.
pub struct TlsAssets {
    pub ca_pem: PathBuf,
    pub server_combined_pem: PathBuf,
    pub _tempdir: tempfile::TempDir, // keep alive for the test's lifetime
}

/// Generate a self-signed CA + a server cert signed by it. SAN covers
/// `localhost` + `127.0.0.1` so the mongodb driver's hostname check passes.
pub fn generate_tls_assets() -> Result<TlsAssets, String> {
    let tempdir = tempfile::Builder::new()
        .prefix("conn-v2-tls-certs-")
        .tempdir()
        .map_err(|e| format!("tempdir: {e}"))?;
    let dir = tempdir.path().to_path_buf();

    let ca_key = dir.join("ca.key");
    let ca_pem = dir.join("ca.pem");
    let srv_key = dir.join("server.key");
    let srv_csr = dir.join("server.csr");
    let srv_crt = dir.join("server.crt");
    let srv_pem = dir.join("server.pem"); // key + cert concatenated
    let srv_ext = dir.join("server.ext");

    // 1. CA key + self-signed cert
    run_with_timeout(
        "openssl",
        &[
            "req",
            "-x509",
            "-newkey", "rsa:2048",
            "-days", "1",
            "-nodes",
            "-keyout", ca_key.to_str().unwrap(),
            "-out", ca_pem.to_str().unwrap(),
            "-subj", "/CN=conn-v2-test-ca",
        ],
        Duration::from_secs(30),
    )?;

    // 2. server key + CSR
    run_with_timeout(
        "openssl",
        &[
            "req",
            "-newkey", "rsa:2048",
            "-nodes",
            "-keyout", srv_key.to_str().unwrap(),
            "-out", srv_csr.to_str().unwrap(),
            "-subj", "/CN=localhost",
        ],
        Duration::from_secs(30),
    )?;

    // 3. SAN extension file
    std::fs::write(
        &srv_ext,
        b"subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
    )
    .map_err(|e| format!("write ext: {e}"))?;

    // 4. sign server cert with CA + SAN
    run_with_timeout(
        "openssl",
        &[
            "x509",
            "-req",
            "-in", srv_csr.to_str().unwrap(),
            "-CA", ca_pem.to_str().unwrap(),
            "-CAkey", ca_key.to_str().unwrap(),
            "-CAcreateserial",
            "-out", srv_crt.to_str().unwrap(),
            "-days", "1",
            "-extfile", srv_ext.to_str().unwrap(),
        ],
        Duration::from_secs(30),
    )?;

    // 5. combined PEM = key + cert (mongod's --tlsCertificateKeyFile format)
    let key_bytes = std::fs::read(&srv_key).map_err(|e| format!("read srv key: {e}"))?;
    let crt_bytes = std::fs::read(&srv_crt).map_err(|e| format!("read srv crt: {e}"))?;
    let mut combined = Vec::with_capacity(key_bytes.len() + crt_bytes.len() + 1);
    combined.extend_from_slice(&key_bytes);
    if !key_bytes.ends_with(b"\n") {
        combined.push(b'\n');
    }
    combined.extend_from_slice(&crt_bytes);
    std::fs::write(&srv_pem, &combined).map_err(|e| format!("write combined pem: {e}"))?;

    // Make the dir + files readable by anyone, since mongod inside the
    // container runs as uid 999 (the `mongodb` user in the official image)
    // and would otherwise fail to read the bind-mounted files.
    set_world_readable(dir.as_path())?;

    Ok(TlsAssets {
        ca_pem,
        server_combined_pem: srv_pem,
        _tempdir: tempdir,
    })
}

fn set_world_readable(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let walk = std::fs::read_dir(dir).map_err(|e| format!("readdir: {e}"))?;
        let mut perms = std::fs::metadata(dir).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(dir, perms).map_err(|e| e.to_string())?;
        for entry in walk {
            let entry = entry.map_err(|e| e.to_string())?;
            let mut p = entry.metadata().map_err(|e| e.to_string())?.permissions();
            p.set_mode(0o644);
            std::fs::set_permissions(entry.path(), p).map_err(|e| e.to_string())?;
        }
    }
    let _ = dir;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// SSH keypair generation — ssh-keygen shell-out
// ──────────────────────────────────────────────────────────────────────────

pub struct SshKeypair {
    pub private_path: PathBuf,
    pub public_str: String,
    pub _tempdir: tempfile::TempDir,
}

/// Generate an unencrypted ed25519 keypair. Returns the private-key path
/// (for the client side) and the public-key contents (to feed into the
/// SSH server container via env var or authorized_keys mount).
pub fn generate_ssh_keypair() -> Result<SshKeypair, String> {
    let tempdir = tempfile::Builder::new()
        .prefix("conn-v2-ssh-key-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let priv_path = tempdir.path().join("id_ed25519");
    let pub_path = tempdir.path().join("id_ed25519.pub");

    run_with_timeout(
        "ssh-keygen",
        &[
            "-t", "ed25519",
            "-N", "",
            "-C", "conn-v2-test",
            "-f", priv_path.to_str().unwrap(),
        ],
        Duration::from_secs(15),
    )?;

    let public_str = std::fs::read_to_string(&pub_path)
        .map_err(|e| format!("read pub key: {e}"))?
        .trim()
        .to_string();

    Ok(SshKeypair {
        private_path: priv_path,
        public_str,
        _tempdir: tempdir,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Connection builders — boilerplate-light constructors
// ──────────────────────────────────────────────────────────────────────────

pub fn direct_conn(host: &str, port: u16, auth: AuthMode, tls: Option<Tls>) -> Connection {
    Connection {
        id: format!("c-{}", uuid::Uuid::new_v4().simple()),
        name: "integration-test".into(),
        color: None,
        target: ConnectionTarget::Direct {
            host: host.into(),
            port,
            replica_set: None,
            read_preference: None,
            direct_connection: Some(true),
        },
        auth,
        tls,
        ssh: None,
        proxy: None,
        overrides: None,
        created_at: "2026-05-28T00:00:00Z".into(),
    }
}

pub fn scram_auth(user: &str, mech: Option<ScramMechanism>) -> AuthMode {
    AuthMode::Scram {
        username: user.into(),
        auth_db: "admin".into(),
        mechanism: mech,
    }
}

pub fn add_ssh_password(
    conn: &mut Connection,
    host: &str,
    port: u16,
    user: &str,
) {
    conn.ssh = Some(SshTunnel {
        host: host.into(),
        port,
        user: user.into(),
        auth: SshAuth::Password,
        known_hosts_policy: KnownHostsPolicy::AcceptAny,
    });
}

pub fn add_ssh_key(
    conn: &mut Connection,
    host: &str,
    port: u16,
    user: &str,
    key_path: &Path,
) {
    conn.ssh = Some(SshTunnel {
        host: host.into(),
        port,
        user: user.into(),
        auth: SshAuth::Key {
            key_path: key_path.to_string_lossy().into_owned(),
            has_passphrase: false,
        },
        known_hosts_policy: KnownHostsPolicy::AcceptAny,
    });
}

pub fn add_socks5(conn: &mut Connection, host: &str, port: u16) {
    conn.proxy = Some(Proxy {
        kind: ProxyKind::Socks5,
        host: host.into(),
        port,
        auth: None,
    });
}

// ──────────────────────────────────────────────────────────────────────────
// Mongo health probe via the driver — the actual end-to-end assertion
// ──────────────────────────────────────────────────────────────────────────

/// Build a `ClientOptions` from the given resolved connection, hand it to
/// the mongodb driver, run `{ping: 1}` against `admin`, and tear the
/// tunnel down. Returns Ok(latency) on success.
pub async fn ping_via_builder(
    resolved: &mongo_lens::connection::builder::ResolvedConnection<'_>,
) -> Result<Duration, String> {
    use mongo_lens::connection::builder::build_client_options;
    use mongodb::bson::doc;
    use mongodb::Client;

    let log = null_log();
    let (opts, tunnel) = build_client_options(resolved, &fast_prefs(), log)
        .await
        .map_err(|e| format!("build_client_options stage={:?}: {}", e.stage, e.error))?;

    let client = Client::with_options(opts).map_err(|e| format!("Client::with_options: {e}"))?;
    let started = Instant::now();
    let ping_result = client
        .database("admin")
        .run_command(doc! { "ping": 1 })
        .await;
    let elapsed = started.elapsed();

    // Always teardown the tunnel, even on ping failure.
    if let Some(t) = tunnel {
        t.close().await;
    }
    // Drop the client to close mongo sockets.
    drop(client);

    ping_result.map_err(|e| format!("ping: {e}"))?;
    Ok(elapsed)
}
