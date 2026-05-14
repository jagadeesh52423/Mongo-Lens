use crate::logger::Logger;
use crate::logctx;
use crate::ssh::config::SshConfig;
use crate::ssh::errors::SshError;
use crate::ssh::host_key::{HandlerError, HostKeyDecision, HostKeyVerifier};
use russh::client;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::timeout;

// russh's `Handle` is backed by an mpsc Sender to the session task — channel opens are
// already concurrent without a mutex. Wrapping in `Arc` (not `Arc<Mutex>`) lets multiple
// MongoDB pool connections open their direct-tcpip channels truly in parallel (C1).

/// Timeout for the SSH TCP connect + handshake combined.
const SSH_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Timeout for opening a `direct-tcpip` channel per incoming local connection.
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(10);

/// A live SSH tunnel handle. Drop this (or call `close()`) to shut the tunnel down.
pub struct TunnelHandle {
    /// The local address the MongoDB driver should connect to.
    pub local_addr: SocketAddr,
    /// Signal to the background listener task to stop accepting new connections.
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Background task joining handle.
    join: Option<JoinHandle<()>>,
    /// Watch sender for session liveness — `true` while alive, `false` after disconnect (I-1).
    alive_tx: Arc<watch::Sender<bool>>,
}

impl TunnelHandle {
    /// Returns a cloned `watch::Receiver` for this tunnel's liveness channel.
    ///
    /// Callers that need to await the session dropping should hold their own clone and call
    /// `receiver.changed().await` — `changed` requires `&mut self`, so each waiter needs its
    /// own clone (N-8).
    pub fn alive_watch(&self) -> watch::Receiver<bool> {
        self.alive_tx.subscribe()
    }

    /// Gracefully shut down the tunnel.
    pub async fn close(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.join.take() {
            // Give the background task 2s to exit, then detach.
            let _ = timeout(Duration::from_secs(2), handle).await;
        }
    }
}

/// Result of a host key check that needs user interaction.
pub enum TunnelStartResult {
    /// Tunnel is open and ready.
    Ready(TunnelHandle),
    /// The host key was not found in any known_hosts store; user must confirm.
    HostKeyUnknown {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    /// The host key has changed — refuse connection, never auto-accept.
    HostKeyChanged {
        host: String,
        stored_source: &'static str,
    },
}

/// Open an SSH tunnel for the given `SshConfig`.
///
/// - Binds a local TCP listener on `127.0.0.1:0` (OS assigns ephemeral port).
/// - Connects to the SSH server and authenticates.
/// - Spawns a background task that forwards each accepted local connection
///   through a `direct-tcpip` channel to the configured MongoDB host:port.
///
/// `accept_unknown_host_key`: pass `true` on the second call after the user
/// confirmed the fingerprint in the UI (causes the verifier to persist the key).
pub async fn open_tunnel(
    cfg: SshConfig,
    accept_unknown_host_key: bool,
    log: Arc<dyn Logger>,
) -> Result<TunnelStartResult, SshError> {
    // Bind local listener first so we know the port before any network I/O.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(SshError::LocalBind)?;
    let local_addr = listener.local_addr().map_err(SshError::LocalBind)?;

    // Watch channel: `true` = alive, `false` = session dropped (I-1).
    let (alive_tx, alive_rx) = watch::channel(true);
    let alive_tx = Arc::new(alive_tx);

    let host_key_decision: Arc<Mutex<Option<HostKeyDecision>>> = Arc::new(Mutex::new(None));

    let verifier = HostKeyVerifier {
        host: cfg.ssh_host.clone(),
        port: cfg.ssh_port,
        accept_unknown: accept_unknown_host_key,
        decision: host_key_decision.clone(),
        alive_tx: alive_tx.clone(),
    };

    // inactivity_timeout causes the session to be GC'd if nothing arrives.
    // The actual TCP connect timeout is enforced by the outer `timeout()` wrapper.
    let russh_config = Arc::new(client::Config {
        inactivity_timeout: Some(SSH_CONNECT_TIMEOUT),
        ..<client::Config as Default>::default()
    });

    let ssh_addr = format!("{}:{}", cfg.ssh_host, cfg.ssh_port);

    log.info(
        "ssh connect",
        logctx! {
            "sshHost" => cfg.ssh_host.clone(),
            "sshPort" => cfg.ssh_port,
            "sshUser" => cfg.ssh_user.clone(),
            "target"  => format!("{}:{}", cfg.target_host, cfg.target_port),
        },
    );

    // Attempt to connect; if it fails check whether it was a host key issue.
    let connect_result = timeout(
        SSH_CONNECT_TIMEOUT,
        client::connect(russh_config, &ssh_addr, verifier),
    )
    .await
    .map_err(|_| SshError::ConnectTimeout)?
    .map_err(|e: HandlerError| SshError::SshHandshake(e.0));

    match connect_result {
        Err(SshError::SshHandshake(ref msg)) => {
            // Check if a host key decision was recorded before we return the generic error.
            if let Some(decision) = host_key_decision.lock().unwrap().take() {
                return Ok(match decision {
                    HostKeyDecision::Unknown {
                        host,
                        port,
                        algorithm,
                        fingerprint,
                    } => TunnelStartResult::HostKeyUnknown {
                        host,
                        port,
                        algorithm,
                        fingerprint,
                    },
                    HostKeyDecision::Changed { host, stored_source } => {
                        TunnelStartResult::HostKeyChanged { host, stored_source }
                    }
                });
            }
            Err(SshError::SshHandshake(msg.clone()))
        }
        Err(e) => Err(e),
        Ok(mut handle) => {
            // Authenticate. Must complete before wrapping in Arc since it requires &mut Handle.
            cfg.auth.authenticate(&mut handle, &cfg.ssh_user).await?;

            log.info("ssh authenticated", logctx! { "method" => cfg.auth.id() });

            // Wrap in Arc only (no Mutex): russh Handle is an mpsc Sender internally,
            // so concurrent channel opens are safe without a lock (C1).
            let handle = Arc::new(handle);
            let target_host = cfg.target_host.clone();
            let target_port = cfg.target_port;
            let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
            let log_task = log.clone();

            // Spawn the listener loop in the background.
            let join = tokio::spawn(async move {
                listener_loop(
                    listener,
                    handle,
                    target_host,
                    target_port,
                    shutdown_rx,
                    log_task,
                    alive_rx,
                )
                .await;
            });

            Ok(TunnelStartResult::Ready(TunnelHandle {
                local_addr,
                shutdown_tx: Some(shutdown_tx),
                join: Some(join),
                alive_tx,
            }))
        }
    }
}

/// Accept loop: for each incoming local TCP connection, open a direct-tcpip channel
/// and forward bidirectionally until either side closes.
///
/// Exits when the shutdown signal fires or when the SSH session goes dead (watch → false).
async fn listener_loop(
    listener: TcpListener,
    handle: Arc<client::Handle<HostKeyVerifier>>,
    target_host: String,
    target_port: u16,
    mut shutdown_rx: oneshot::Receiver<()>,
    log: Arc<dyn Logger>,
    mut alive_rx: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            biased;
            _ = &mut shutdown_rx => break,
            // Wake up when the watch channel transitions (session dropped).
            changed = alive_rx.changed() => {
                if changed.is_err() || !*alive_rx.borrow() {
                    log.warn("ssh session dead, closing tunnel", logctx! {});
                    break;
                }
            }
            accept_result = listener.accept() => {
                match accept_result {
                    Err(e) => {
                        log.warn("ssh tunnel accept error", logctx! { "err" => e.to_string() });
                        break;
                    }
                    Ok((local_stream, peer_addr)) => {
                        let handle = handle.clone();
                        let target_host = target_host.clone();
                        let log = log.clone();
                        tokio::spawn(async move {
                            forward_connection(
                                local_stream,
                                peer_addr,
                                handle,
                                &target_host,
                                target_port,
                                log,
                            )
                            .await;
                        });
                    }
                }
            }
        }
    }
}

/// Forward one local TCP connection through a `direct-tcpip` SSH channel.
async fn forward_connection(
    mut local_stream: TcpStream,
    peer_addr: SocketAddr,
    handle: Arc<client::Handle<HostKeyVerifier>>,
    target_host: &str,
    target_port: u16,
    log: Arc<dyn Logger>,
) {
    let target_display = format!("{target_host}:{target_port}");
    log.debug(
        "ssh tunnel new connection",
        logctx! { "peer" => peer_addr.to_string(), "target" => target_display.clone() },
    );

    // Open the direct-tcpip channel with a timeout.
    // Handle is Arc<client::Handle> (no Mutex) — channel opens are concurrent (C1).
    let channel_result = timeout(
        CHANNEL_OPEN_TIMEOUT,
        handle.channel_open_direct_tcpip(target_host, target_port as u32, "127.0.0.1", 0),
    )
    .await;

    let channel = match channel_result {
        Err(_) => {
            log.warn(
                "ssh channel open timed out",
                logctx! { "target" => target_display },
            );
            return;
        }
        Ok(Err(e)) => {
            let msg = e.to_string();
            // Distinguish "server refused" (config error) from transport failure.
            if msg.contains("open failed") || msg.contains("refused") || msg.contains("prohibited") {
                log.warn(
                    "ssh channel refused by server",
                    logctx! { "target" => target_display, "err" => msg },
                );
            } else {
                log.warn(
                    "ssh channel failed",
                    logctx! { "target" => target_display, "err" => msg },
                );
            }
            return;
        }
        Ok(Ok(ch)) => ch,
    };

    // Copy bytes bidirectionally until either side closes.
    let mut ssh_stream = channel.into_stream();
    if let Err(e) = copy_bidirectional(&mut local_stream, &mut ssh_stream).await {
        // EOF is normal; log only unexpected errors.
        let msg = e.to_string().to_ascii_lowercase();
        if !msg.contains("eof") && !msg.contains("broken pipe") && !msg.contains("reset") {
            log.debug(
                "ssh tunnel forward ended",
                logctx! { "target" => target_display, "err" => e.to_string() },
            );
        }
    }
}
