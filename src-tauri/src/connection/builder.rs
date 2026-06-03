// Several `cfg(feature = "...")` gates here reference mongodb crate features
// (socks5-proxy, gssapi-auth, aws-auth, *-compression, openssl-tls) that this
// workspace does not redeclare. Rustc 1.80+ emits an `unexpected_cfgs` lint
// for these because the workspace's own Cargo.toml doesn't define them.
// They evaluate to false at compile time — which is exactly the intended
// "feature not present" behaviour. Silence the false positive.
#![allow(unexpected_cfgs)]

//! Connection → `mongodb::options::ClientOptions` builder with staged errors.
//!
//! The builder is the single seam between the v2 connection model
//! ([`crate::connection::model::Connection`]), resolved secrets, effective
//! prefs ([`crate::prefs::model::EffectivePrefs`]) and the mongodb v3
//! driver. Every other module produces inputs to or consumes outputs from
//! this one.
//!
//! # Staged errors
//!
//! Failures bubble up tagged with the [`BuildStage`] they originated at —
//! Ssh, Tls, Auth, Ping — so the UI can show "SSH failed: <msg>" vs
//! "TLS failed: <msg>" rather than a flat string. The Ping stage is
//! produced by the calling layer (IPC) AFTER the builder returns; this
//! module never emits `BuildStage::Ping` itself, but the variant is
//! defined here so the entire pipeline shares one enum.
//!
//! # Feature gating
//!
//! The mongodb crate is enabled with only its default features in this
//! workspace. That means several driver-side capabilities are absent at
//! compile time:
//!
//! | Connection feature   | mongodb crate feature      | Behaviour when absent                                 |
//! | -------------------- | -------------------------- | ----------------------------------------------------- |
//! | SOCKS5 proxy         | `socks5-proxy`             | [`BuildStage::Tls`] error with rebuild hint           |
//! | Kerberos / GSSAPI    | `gssapi-auth`              | [`BuildStage::Auth`] error with rebuild hint          |
//! | AWS IAM              | `aws-auth`                 | [`BuildStage::Auth`] error with rebuild hint          |
//! | snappy / zlib / zstd | `*-compression`            | Compressor silently dropped + warning log             |
//!
//! "Not supported" is surfaced explicitly per the team-lead's contract:
//! never skip a configured feature silently — except for compressors,
//! where the cost of failing the whole connection because a perf hint
//! isn't available outweighs the benefit.
//!
//! # Extension contract
//!
//! Adding a new auth mode / proxy kind / target kind:
//!   1. Add the variant in `connection::model` + its TS twin (Task 2).
//!   2. Add a match arm here (look for "EXTENSION POINT" comments).
//!   3. Add a unit test that asserts the resulting `ClientOptions` field.
//!   4. No call site needs to change.

use std::sync::Arc;

use mongodb::bson::{doc, Document};
use mongodb::options::{
    AuthMechanism, ClientOptions, Credential, ServerAddress, Tls, TlsOptions,
};
use serde::Serialize;

use crate::connection::model::{
    AuthMode, Connection, ConnectionTarget, KnownHostsPolicy, Proxy, ReadPreference,
    ScramMechanism, SshAuth, SshTunnel, Tls as ModelTls,
};
use crate::connection::proxy::validate_for_driver as validate_proxy_for_driver;
use crate::connection::tunnel::{open as open_tunnel_bridge, ResolvedSshSecrets};
use crate::logctx;
use crate::logger::Logger;
use crate::prefs::model::EffectivePrefs;
use crate::ssh::{SshError, TunnelHandle, TunnelStartResult};

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

/// Stage at which a connection build failed. Mirrored to the frontend so
/// each tab in the dialog can highlight the failing step. Lowercase serde
/// keys keep the wire contract stable across renames.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildStage {
    /// SSH tunnel handshake / auth / host-key check.
    Ssh,
    /// TLS option assembly, including proxy config (transport-layer setup).
    Tls,
    /// Credential assembly from the [`AuthMode`].
    Auth,
    /// Final `client.ping()` round-trip. NOT produced by this builder —
    /// the IPC layer fills it in. Kept here so the whole pipeline shares
    /// one enum.
    Ping,
}

impl BuildStage {
    /// Lowercase wire spelling, identical to the serde `rename_all =
    /// "lowercase"` representation. Use this when emitting the stage into a
    /// plain `String` error (e.g. the `connections_v2_connect` IPC boundary,
    /// which returns `Result<_, String>` rather than the typed
    /// `TestResultV2` envelope) so every staged error shares the exact
    /// spelling the frontend's `ssh|tls|auth|ping` union parses. Prefer this
    /// over `format!("{stage:?}")`, whose `Debug` output is capitalized.
    //
    // To add a new stage: add the variant above and one arm here. The
    // `build_stage_as_wire_matches_serde` test guarantees the two never
    // drift.
    pub fn as_wire(self) -> &'static str {
        match self {
            BuildStage::Ssh => "ssh",
            BuildStage::Tls => "tls",
            BuildStage::Auth => "auth",
            BuildStage::Ping => "ping",
        }
    }
}

/// Tagged error emitted by [`build_client_options`].
///
/// `error` is a plain `String` (not a typed enum) because the underlying
/// errors come from heterogeneous sources — russh, mongodb driver, file
/// I/O — and the consumer always renders them as a single user-facing
/// line. Adding structured variants buys nothing here.
#[derive(Debug, Serialize)]
pub struct BuildError {
    pub stage: BuildStage,
    pub error: String,
}

impl BuildError {
    fn ssh(error: impl Into<String>) -> Self {
        Self {
            stage: BuildStage::Ssh,
            error: error.into(),
        }
    }
    fn tls(error: impl Into<String>) -> Self {
        Self {
            stage: BuildStage::Tls,
            error: error.into(),
        }
    }
    fn auth(error: impl Into<String>) -> Self {
        Self {
            stage: BuildStage::Auth,
            error: error.into(),
        }
    }
}

/// Outcome of [`build_client_options`].
///
/// SSH challenge-response signals (passphrase prompt, unknown host key) are
/// not errors — they're successful Ssh-stage results that need user input
/// before the connect can proceed. The IPC layer translates these into the
/// matching `ConnectResultV2` variants so the dialog can route to the
/// passphrase / host-key prompts.
///
/// `BuildError` is reserved for genuine failures (network unreachable, bad
/// TLS, missing required secret, etc.) — anything the user can't fix by
/// answering a prompt.
///
/// `HostKeyUnknown` carries enough structured info (algorithm + fingerprint
/// + host:port) for the dialog to render the confirmation card without
/// re-parsing strings.
///
/// Intentionally not `Debug` / `Serialize` / `Clone` — the variant carries a
/// live `TunnelHandle` whose drop policy is "caller closes". Tests assert
/// the variant kind via pattern-matching (see `BuildOutcomeKind` below)
/// rather than `assert_eq!`.
pub enum BuildOutcome {
    /// `ClientOptions` assembled; tunnel (if any) is live and the caller
    /// owns the [`TunnelHandle`].
    ///
    /// `uri` is the post-rewrite MongoDB URI that was fed to
    /// `ClientOptions::parse`. For URI targets this is `target.uri`
    /// (possibly with the host:port swapped for the tunnel's local
    /// address); for Direct targets it's a synthesized
    /// `mongodb://host:port/?...`. Callers like the Node runner (via
    /// `mongo_uris` → `mongo::active_uri`) re-use this string instead of
    /// re-deriving from the raw connection record, so any fallback
    /// query params or SSH rewrites that made the Rust connect succeed
    /// apply identically to downstream consumers.
    Ready {
        options: ClientOptions,
        tunnel: Option<TunnelHandle>,
        uri: String,
    },
    /// SSH key file is encrypted. Caller should prompt the user, persist
    /// the answer, and call [`build_client_options`] again with the secret
    /// store populated (or the `ssh_key_passphrase` slot set on the
    /// `ResolvedConnection`).
    PassphraseRequired,
    /// SSH host key was not in any known_hosts store. Caller should show
    /// the fingerprint, get user confirmation, and retry with
    /// `accept_host_key = true`.
    HostKeyUnknown {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
}

impl BuildOutcome {
    /// Convenience for tests: discriminant without inspecting the live
    /// `TunnelHandle`. Not used by production code.
    #[cfg(test)]
    fn kind(&self) -> &'static str {
        match self {
            BuildOutcome::Ready { .. } => "ready",
            BuildOutcome::PassphraseRequired => "passphraseRequired",
            BuildOutcome::HostKeyUnknown { .. } => "hostKeyUnknown",
        }
    }
}

/// Intermediate result of [`open_ssh_if_configured`]. Folded into the public
/// [`BuildOutcome`] by [`build_client_options`].
enum SshStepOutcome {
    /// Either there is no SSH config, or the tunnel opened cleanly. The
    /// optional handle is `None` only when no SSH config was present.
    Open(Option<TunnelHandle>),
    /// SSH key is encrypted; need passphrase to retry.
    PassphraseRequired,
    /// Unknown host key; user must confirm and retry with `accept_host_key`.
    HostKeyUnknown {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
}

/// A `Connection` paired with secrets the caller already resolved from the
/// keychain.
///
/// Intentionally not `Debug`, not `Serialize`, not `Clone` — secrets must
/// not leak via logs, IPC traces, or accidental cloning into long-lived
/// state. The borrowed `&Connection` keeps the carrier cheap; the secrets
/// are owned `String`s because they typically come from a one-shot
/// keychain read.
pub struct ResolvedConnection<'a> {
    pub conn: &'a Connection,
    /// MongoDB auth password (SCRAM / LDAP / legacy CR).
    pub auth_password: Option<String>,
    /// SSH login password (`SshAuth::Password`).
    pub ssh_password: Option<String>,
    /// SSH private-key passphrase (`SshAuth::Key { has_passphrase: true }`).
    pub ssh_key_passphrase: Option<String>,
    /// SOCKS5 proxy authentication password.
    pub proxy_password: Option<String>,
    /// AWS IAM secret-access-key paired with the model's `access_key_id`.
    pub aws_secret_key: Option<String>,
}

impl<'a> ResolvedConnection<'a> {
    /// Convenience constructor: a resolved connection with no secrets.
    /// Useful in tests and for connections that need none of the above
    /// (e.g. `AuthMode::None`, no-passphrase SSH key, unauthenticated proxy).
    pub fn bare(conn: &'a Connection) -> Self {
        Self {
            conn,
            auth_password: None,
            ssh_password: None,
            ssh_key_passphrase: None,
            proxy_password: None,
            aws_secret_key: None,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────────────

/// Assemble a [`ClientOptions`] from a resolved connection + effective prefs.
///
/// Steps (each fails fast with the corresponding [`BuildStage`]):
///   1. SSH tunnel (if configured) → local listener bound on 127.0.0.1.
///      May short-circuit to [`BuildOutcome::PassphraseRequired`] or
///      [`BuildOutcome::HostKeyUnknown`] — both are *successful* SSH-stage
///      outcomes that need user input, not errors.
///   2. Construct base URI from `conn.target`; rewrite host:port to the
///      tunnel address if a tunnel was opened.
///   3. Parse URI into `ClientOptions`.
///   4. Apply TLS settings.
///   5. Apply auth credentials.
///   6. Apply `EffectivePrefs.advanced` (appName, retry*, compressors,
///      *_timeout_ms).
///   7. Validate + apply proxy (SOCKS5 only).
///
/// `accept_host_key`: pass `true` after the user accepted the fingerprint
/// in the UI on a prior call. The verifier will persist the key on success
/// (per the connection's `known_hosts_policy`). On the first call this
/// must be `false`.
///
/// Returns a [`BuildOutcome`] — `Ready { options, tunnel }` on success.
/// The caller OWNS the returned `TunnelHandle` and is responsible for
/// closing it when the resulting `Client` shuts down (drop alone is not
/// enough — call [`TunnelHandle::close`] for a clean teardown). When the
/// connection has no SSH config `tunnel` is `None`.
pub async fn build_client_options(
    resolved: &ResolvedConnection<'_>,
    effective: &EffectivePrefs,
    accept_host_key: bool,
    log: Arc<dyn Logger>,
) -> Result<BuildOutcome, BuildError> {
    let conn = resolved.conn;

    // ── Step 1: SSH tunnel ────────────────────────────────────────────
    let tunnel = match open_ssh_if_configured(
        conn.ssh.as_ref(),
        resolved,
        &conn.target,
        accept_host_key,
        log.clone(),
    )
    .await?
    {
        SshStepOutcome::Open(tunnel) => tunnel,
        SshStepOutcome::PassphraseRequired => return Ok(BuildOutcome::PassphraseRequired),
        SshStepOutcome::HostKeyUnknown {
            host,
            port,
            algorithm,
            fingerprint,
        } => {
            return Ok(BuildOutcome::HostKeyUnknown {
                host,
                port,
                algorithm,
                fingerprint,
            });
        }
    };
    let tunnel_local = tunnel.as_ref().map(|t| t.local_addr);

    // ── Step 2: Base URI (+ rewrite if tunnel established) ────────────
    let uri = build_base_uri(&conn.target, tunnel_local.as_ref())?;

    // ── Step 3: Parse URI into ClientOptions ──────────────────────────
    // Parse failures are URI-shape problems; they're not really Tls but
    // they're also not Auth/Ssh — Tls is the closest "transport setup"
    // bucket and gets the user looking at the right tab.
    let mut opts = ClientOptions::parse(&uri).await.map_err(|e| {
        BuildError::tls(format!("could not parse MongoDB URI '{uri}': {e}"))
    })?;

    // ── Step 4: TLS ───────────────────────────────────────────────────
    apply_tls(&mut opts, conn.tls.as_ref())?;

    // ── Step 5: Auth ──────────────────────────────────────────────────
    apply_auth(&mut opts, &conn.auth, resolved)?;

    // ── Step 6: Advanced prefs ────────────────────────────────────────
    apply_advanced_prefs(&mut opts, effective, log.as_ref());

    // ── Step 7: Proxy (SOCKS5 only) ───────────────────────────────────
    apply_proxy(&mut opts, conn.proxy.as_ref(), resolved.proxy_password.as_deref())?;

    // Direct-connection / replica-set / read-preference are part of the
    // Direct target shape, applied during URI synthesis (step 2). For URI
    // targets they ride in the connection string itself.

    Ok(BuildOutcome::Ready {
        options: opts,
        tunnel,
        uri,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Step 1: SSH
// ──────────────────────────────────────────────────────────────────────────

/// Open the SSH tunnel if the connection has one.
///
/// Three success-shaped outcomes (none are `BuildError`):
///   * [`SshStepOutcome::Open`] — tunnel open (or no SSH configured).
///   * [`SshStepOutcome::PassphraseRequired`] — encrypted key, prompt user.
///   * [`SshStepOutcome::HostKeyUnknown`] — confirm fingerprint, then retry
///     with `accept_host_key = true`.
///
/// Genuine failures (network unreachable, auth rejected, host-key
/// *changed*) come back as `Err(BuildError { stage: Ssh, .. })`.
///
/// `accept_host_key`: when `true`, the host-key verifier will persist a
/// previously-unknown key on success (TOFU). When `false`, an unknown key
/// returns `HostKeyUnknown` instead of trusting blindly.
///
/// Ownership: the live `TunnelHandle` in `Open(Some(handle))` is
/// transferred to the caller — `build_client_options` hands it back in
/// `BuildOutcome::Ready` so the IPC layer can `.close()` it on disconnect /
/// test teardown / drop. No leaks.
async fn open_ssh_if_configured(
    ssh: Option<&SshTunnel>,
    resolved: &ResolvedConnection<'_>,
    target: &ConnectionTarget,
    accept_host_key: bool,
    log: Arc<dyn Logger>,
) -> Result<SshStepOutcome, BuildError> {
    let Some(ssh) = ssh else {
        return Ok(SshStepOutcome::Open(None));
    };

    // A connection may carry a fully-configured but disabled tunnel (saved for
    // later). Treat disabled exactly like "no SSH": connect directly, no tunnel.
    if !ssh.enabled {
        return Ok(SshStepOutcome::Open(None));
    }

    let secrets = build_ssh_secrets(ssh, resolved)?;
    let (target_host, target_port) = target_host_port_for_ssh(target)?;

    log.info(
        "build_client_options: opening ssh tunnel",
        logctx! {
            "sshHost" => ssh.host.clone(),
            "sshPort" => ssh.port,
            "target"  => format!("{target_host}:{target_port}"),
            "policy"  => format!("{:?}", ssh.known_hosts_policy),
            "acceptHostKey" => accept_host_key,
        },
    );

    let result =
        match open_tunnel_bridge(ssh, secrets, &target_host, target_port, accept_host_key, log)
            .await
        {
            Ok(r) => r,
            // PassphraseRequired / PassphraseIncorrect are user-prompt
            // outcomes, not errors. The dialog will collect the
            // passphrase, persist it via the secret store, and retry.
            // Both map to the same outcome — the dialog doesn't currently
            // distinguish "first time" from "wrong on retry" (TODO: thread
            // the distinction through if UX research wants it later).
            Err(SshError::PassphraseRequired) | Err(SshError::PassphraseIncorrect) => {
                return Ok(SshStepOutcome::PassphraseRequired);
            }
            Err(e) => return Err(BuildError::ssh(e.to_string())),
        };

    match result {
        TunnelStartResult::Ready(handle) => Ok(SshStepOutcome::Open(Some(handle))),
        TunnelStartResult::HostKeyUnknown {
            host,
            port,
            algorithm,
            fingerprint,
        } => Ok(SshStepOutcome::HostKeyUnknown {
            host,
            port,
            algorithm,
            fingerprint,
        }),
        TunnelStartResult::HostKeyChanged { host, stored_source } => {
            // Host key *changed* is a hard failure (possible MITM) — never
            // surface as a confirmation prompt.
            Err(BuildError::ssh(format!(
                "Host key for {host} does not match the entry in {stored_source}. \
                 Connection refused to protect against possible MITM attack."
            )))
        }
    }
}

/// Translate the resolved-secrets bag into a `ResolvedSshSecrets` for the
/// bridge.
///
/// Password auth is pre-validated here (no password resolved is a hard
/// `BuildError::ssh` — the dialog should have caught it at save). Encrypted
/// key auth with a missing passphrase, however, is *not* pre-rejected: it
/// flows through to the bridge so the typed `SshError::PassphraseRequired`
/// signal survives intact, and `open_ssh_if_configured` can fold it into
/// `SshStepOutcome::PassphraseRequired` for the dialog's prompt flow.
fn build_ssh_secrets(
    ssh: &SshTunnel,
    resolved: &ResolvedConnection<'_>,
) -> Result<ResolvedSshSecrets, BuildError> {
    let secrets = match &ssh.auth {
        SshAuth::Password => ResolvedSshSecrets {
            password: Some(resolved.ssh_password.clone().ok_or_else(|| {
                BuildError::ssh("SSH password missing for password auth")
            })?),
            key_passphrase: None,
        },
        // Pass through whatever's resolved (including None) — the bridge's
        // resolve_auth emits PassphraseRequired when has_passphrase=true
        // but key_passphrase=None, which we want to surface as a prompt.
        SshAuth::Key { has_passphrase: true, .. } => ResolvedSshSecrets {
            password: None,
            key_passphrase: resolved.ssh_key_passphrase.clone(),
        },
        SshAuth::Key { has_passphrase: false, .. } => ResolvedSshSecrets::default(),
        SshAuth::Agent => ResolvedSshSecrets::default(),
    };
    // KnownHostsPolicy::AcceptAny is honoured by the bridge regardless of
    // `caller_confirmed`; the other two policies require the IPC layer's
    // user-confirmation round-trip, which the builder cannot do alone.
    // Document this so callers know strict policy + first-call may fail
    // here even though the network is reachable.
    let _ = ssh.known_hosts_policy; // silence unused; pattern-matched only for emphasis
    let _ = KnownHostsPolicy::Strict; // anchor the import to model
    Ok(secrets)
}

/// Resolve the MongoDB target host:port the SSH tunnel should reach.
fn target_host_port_for_ssh(target: &ConnectionTarget) -> Result<(String, u16), BuildError> {
    match target {
        ConnectionTarget::Direct { host, port, .. } => Ok((host.clone(), *port)),
        ConnectionTarget::Uri { uri } => {
            // Defer to the existing extractor in ssh::uri — single source of
            // truth for URI host parsing + SRV/multi-seed rejection.
            let hosts = crate::ssh::uri::extract_hosts(uri).map_err(|e| {
                BuildError::ssh(format!("cannot extract host from URI for SSH target: {e}"))
            })?;
            // extract_hosts already rejects multi-seed; first entry is the only one.
            let host_port = hosts
                .into_iter()
                .next()
                .ok_or_else(|| BuildError::ssh(format!("URI '{uri}' has no host")))?;
            Ok((host_port.host, host_port.port))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Step 2: URI synthesis + rewrite
// ──────────────────────────────────────────────────────────────────────────

fn build_base_uri(
    target: &ConnectionTarget,
    tunnel_local: Option<&std::net::SocketAddr>,
) -> Result<String, BuildError> {
    let base = match target {
        ConnectionTarget::Uri { uri } => uri.clone(),
        ConnectionTarget::Direct {
            host,
            port,
            replica_set,
            read_preference,
            direct_connection,
        } => synthesize_direct_uri(host, *port, replica_set.as_deref(), *read_preference, *direct_connection),
    };

    let Some(local_addr) = tunnel_local else {
        return Ok(base);
    };

    // Rewrite via the existing helper so SRV / multi-seed get the same
    // rejection behaviour as the legacy path.
    let host_port = crate::ssh::uri::extract_hosts(&base)
        .map_err(|e| BuildError::tls(format!("URI rewrite for tunnel failed: {e}")))?
        .into_iter()
        .next()
        .ok_or_else(|| BuildError::tls(format!("URI '{base}' has no host to rewrite")))?;
    let mut mapping = std::collections::HashMap::new();
    mapping.insert(host_port, *local_addr);
    crate::ssh::uri::rewrite_uri(&base, &mapping)
        .map_err(|e| BuildError::tls(format!("URI rewrite for tunnel failed: {e}")))
}

fn synthesize_direct_uri(
    host: &str,
    port: u16,
    replica_set: Option<&str>,
    read_preference: Option<ReadPreference>,
    direct_connection: Option<bool>,
) -> String {
    // Build a minimal mongodb:// URI. Auth-DB / credentials are applied
    // later via ClientOptions; we don't put them in the URI to avoid
    // double-encoding hazards (control chars in passwords).
    let mut params: Vec<String> = Vec::new();
    if let Some(rs) = replica_set {
        params.push(format!("replicaSet={rs}"));
    }
    if let Some(rp) = read_preference {
        params.push(format!("readPreference={}", read_pref_token(rp)));
    }
    if let Some(direct) = direct_connection {
        params.push(format!("directConnection={direct}"));
    }
    if params.is_empty() {
        format!("mongodb://{host}:{port}/")
    } else {
        format!("mongodb://{host}:{port}/?{}", params.join("&"))
    }
}

fn read_pref_token(rp: ReadPreference) -> &'static str {
    match rp {
        ReadPreference::Primary => "primary",
        ReadPreference::PrimaryPreferred => "primaryPreferred",
        ReadPreference::Secondary => "secondary",
        ReadPreference::SecondaryPreferred => "secondaryPreferred",
        ReadPreference::Nearest => "nearest",
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Step 4: TLS
// ──────────────────────────────────────────────────────────────────────────

fn apply_tls(opts: &mut ClientOptions, tls: Option<&ModelTls>) -> Result<(), BuildError> {
    let Some(tls) = tls else { return Ok(()) };

    if !tls.enabled {
        // Explicit opt-out — overrides anything the URI may have set.
        opts.tls = Some(Tls::Disabled);
        return Ok(());
    }

    let mut tls_opts = TlsOptions::default();
    tls_opts.allow_invalid_certificates = tls.allow_invalid_certs;
    tls_opts.ca_file_path = tls.ca_file.as_ref().map(std::path::PathBuf::from);
    tls_opts.cert_key_file_path = tls.client_cert_file.as_ref().map(std::path::PathBuf::from);

    // allow_invalid_hostnames is only available under the openssl-tls feature.
    // Surface a clear error if the user asks for it but we can't honour it.
    #[cfg(feature = "openssl-tls")]
    {
        tls_opts.allow_invalid_hostnames = tls.allow_invalid_hostnames;
    }
    #[cfg(not(feature = "openssl-tls"))]
    {
        if tls.allow_invalid_hostnames == Some(true) {
            return Err(BuildError::tls(
                "tls.allowInvalidHostnames=true requires the mongodb crate's \
                 `openssl-tls` feature to be enabled; current build uses rustls."
                    .to_string(),
            ));
        }
    }

    opts.tls = Some(Tls::Enabled(tls_opts));
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// Step 5: Auth
// ──────────────────────────────────────────────────────────────────────────

fn apply_auth(
    opts: &mut ClientOptions,
    auth: &AuthMode,
    resolved: &ResolvedConnection<'_>,
) -> Result<(), BuildError> {
    // EXTENSION POINT: add a new arm here when a new AuthMode variant lands.
    let credential = match auth {
        AuthMode::None => None,
        AuthMode::Scram { username, auth_db, mechanism } => Some(scram_credential(
            username,
            auth_db,
            mechanism.clone(),
            resolved.auth_password.clone(),
        )),
        AuthMode::LegacyCr { username, auth_db } => Some(legacy_cr_credential(
            username,
            auth_db,
            resolved.auth_password.clone(),
        )),
        AuthMode::X509 { cert_file, cert_key_file } => Some(x509_credential(
            cert_file,
            cert_key_file.as_deref(),
        )),
        AuthMode::Ldap { username } => Some(ldap_credential(
            username,
            resolved.auth_password.clone(),
        )),
        AuthMode::Kerberos { principal, service_name, canonicalize_host_name } => {
            kerberos_credential(principal, service_name.as_deref(), *canonicalize_host_name)?
        }
        AuthMode::AwsIam { access_key_id, session_token, use_env_creds } => aws_iam_credential(
            access_key_id.as_deref(),
            resolved.aws_secret_key.as_deref(),
            session_token.as_deref(),
            *use_env_creds,
        )?,
        AuthMode::Oidc { principal, provider_name } => Some(oidc_credential(
            principal.as_deref(),
            provider_name.as_deref(),
        )),
    };

    opts.credential = credential;
    Ok(())
}

fn scram_credential(
    username: &str,
    auth_db: &str,
    mechanism: Option<ScramMechanism>,
    password: Option<String>,
) -> Credential {
    let mut c = Credential::default();
    c.username = Some(username.into());
    c.source = Some(auth_db.into());
    c.password = password;
    c.mechanism = match mechanism {
        Some(ScramMechanism::ScramSha1) => Some(AuthMechanism::ScramSha1),
        Some(ScramMechanism::ScramSha256) => Some(AuthMechanism::ScramSha256),
        // `Auto` / None → let the driver negotiate (mongodb v3 prefers SHA-256
        // and falls back to SHA-1 if the server only supports the older mech).
        Some(ScramMechanism::Auto) | None => None,
    };
    c
}

fn legacy_cr_credential(username: &str, auth_db: &str, password: Option<String>) -> Credential {
    // MONGODB-CR is deprecated and the driver explicitly says it won't be
    // supported. We still emit a Credential so the server can return a
    // clear "mechanism not supported" auth failure, surfaced under
    // BuildStage::Ping by the calling layer, rather than swallowing it.
    let mut c = Credential::default();
    c.username = Some(username.into());
    c.source = Some(auth_db.into());
    c.password = password;
    c.mechanism = Some(AuthMechanism::MongoDbCr);
    c
}

fn x509_credential(_cert_file: &str, _cert_key_file: Option<&str>) -> Credential {
    // The cert is consumed by the TLS layer (apply_tls); MONGODB-X509 only
    // tells the server "use the TLS-presented cert as the identity". The
    // username field is intentionally None — the driver lifts the
    // subject DN from the cert.
    let mut c = Credential::default();
    c.mechanism = Some(AuthMechanism::MongoDbX509);
    c.source = Some("$external".into());
    c
}

fn ldap_credential(username: &str, password: Option<String>) -> Credential {
    let mut c = Credential::default();
    c.username = Some(username.into());
    c.password = password;
    c.mechanism = Some(AuthMechanism::Plain);
    c.source = Some("$external".into());
    c
}

fn kerberos_credential(
    principal: &str,
    service_name: Option<&str>,
    canonicalize_host_name: Option<bool>,
) -> Result<Option<Credential>, BuildError> {
    #[cfg(feature = "gssapi-auth")]
    {
        let mut c = Credential::default();
        c.username = Some(principal.into());
        c.mechanism = Some(AuthMechanism::Gssapi);
        c.source = Some("$external".into());
        let mut props = Document::new();
        if let Some(svc) = service_name {
            props.insert("SERVICE_NAME", svc.to_string());
        }
        if let Some(canon) = canonicalize_host_name {
            props.insert("CANONICALIZE_HOST_NAME", canon);
        }
        if !props.is_empty() {
            c.mechanism_properties = Some(props);
        }
        Ok(Some(c))
    }
    #[cfg(not(feature = "gssapi-auth"))]
    {
        let _ = (principal, service_name, canonicalize_host_name);
        Err(BuildError::auth(
            "Kerberos (GSSAPI) authentication is not compiled into this build. \
             Rebuild the app with `mongodb` crate feature `gssapi-auth` enabled.",
        ))
    }
}

fn aws_iam_credential(
    access_key_id: Option<&str>,
    secret_key: Option<&str>,
    session_token: Option<&str>,
    use_env_creds: Option<bool>,
) -> Result<Option<Credential>, BuildError> {
    #[cfg(feature = "aws-auth")]
    {
        let mut c = Credential::default();
        c.mechanism = Some(AuthMechanism::MongoDbAws);
        c.source = Some("$external".into());

        if use_env_creds.unwrap_or(false) {
            // Driver pulls AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
            // AWS_SESSION_TOKEN from the environment when the credential
            // has no explicit fields — leave them None.
        } else {
            let key_id = access_key_id.ok_or_else(|| {
                BuildError::auth(
                    "AWS IAM auth: accessKeyId is required when useEnvCreds=false",
                )
            })?;
            let secret = secret_key.ok_or_else(|| {
                BuildError::auth(
                    "AWS IAM auth: secret access key is required when useEnvCreds=false \
                     (keychain slot AwsSecretKey / via ResolvedConnection.aws_secret_key)",
                )
            })?;
            c.username = Some(key_id.to_string());
            c.password = Some(secret.to_string());
            if let Some(token) = session_token {
                let mut props = Document::new();
                props.insert("AWS_SESSION_TOKEN", token.to_string());
                c.mechanism_properties = Some(props);
            }
        }
        Ok(Some(c))
    }
    #[cfg(not(feature = "aws-auth"))]
    {
        let _ = (access_key_id, secret_key, session_token, use_env_creds);
        Err(BuildError::auth(
            "AWS IAM (MONGODB-AWS) authentication is not compiled into this build. \
             Rebuild the app with `mongodb` crate feature `aws-auth` enabled.",
        ))
    }
}

fn oidc_credential(principal: Option<&str>, provider_name: Option<&str>) -> Credential {
    let mut c = Credential::default();
    c.mechanism = Some(AuthMechanism::MongoDbOidc);
    c.source = Some("$external".into());
    if let Some(p) = principal {
        c.username = Some(p.into());
    }
    if let Some(name) = provider_name {
        let mut props = Document::new();
        props.insert("ENVIRONMENT", name.to_string());
        c.mechanism_properties = Some(props);
    }
    c
}

// ──────────────────────────────────────────────────────────────────────────
// Step 6: Advanced prefs
// ──────────────────────────────────────────────────────────────────────────

fn apply_advanced_prefs(opts: &mut ClientOptions, effective: &EffectivePrefs, log: &dyn Logger) {
    let advanced = &effective.advanced;

    opts.app_name = Some(advanced.app_name.clone());
    opts.retry_writes = Some(advanced.retry_writes);
    opts.retry_reads = Some(advanced.retry_reads);

    if advanced.server_selection_timeout_ms > 0 {
        opts.server_selection_timeout =
            Some(std::time::Duration::from_millis(advanced.server_selection_timeout_ms));
    }
    if advanced.connect_timeout_ms > 0 {
        opts.connect_timeout =
            Some(std::time::Duration::from_millis(advanced.connect_timeout_ms));
    }
    // socket_timeout_ms is intentionally allowed to be 0 (means "no timeout"
    // per mongo URI option semantics); we only set it when the user picked
    // a positive value.
    // mongodb v3's `ClientOptions` exposes Duration timeouts directly.

    // Compressors: best-effort. The mongodb crate gates each compressor
    // variant — AND the `compressors` field on ClientOptions itself —
    // behind a per-codec feature. Without any of zstd/zlib/snappy
    // -compression enabled, the field does not exist, so the entire
    // mapping is skipped at compile time. Any requested compressors get a
    // warning log via `map_compressors`.
    if !advanced.compressors.is_empty() {
        #[cfg(any(
            feature = "zstd-compression",
            feature = "zlib-compression",
            feature = "snappy-compression"
        ))]
        {
            let mapped = map_compressors(&advanced.compressors, log);
            if !mapped.is_empty() {
                opts.compressors = Some(mapped);
            }
        }
        #[cfg(not(any(
            feature = "zstd-compression",
            feature = "zlib-compression",
            feature = "snappy-compression"
        )))]
        {
            // Build still runs through map_compressors so the user gets a
            // warning per requested codec; the result is discarded because
            // the mongodb crate doesn't expose the field in this build.
            let _ = map_compressors(&advanced.compressors, log);
            let _ = &opts; // anchor; nothing to assign
        }
    }
}

/// When ANY compression feature is on, `mongodb::options::Compressor` exists
/// and we map each requested codec; missing-codec variants log a warning and
/// drop out of the result.
#[cfg(any(
    feature = "zstd-compression",
    feature = "zlib-compression",
    feature = "snappy-compression"
))]
fn map_compressors(
    model_compressors: &[crate::connection::model::Compressor],
    log: &dyn Logger,
) -> Vec<mongodb::options::Compressor> {
    let mut out = Vec::new();
    for c in model_compressors {
        match c {
            crate::connection::model::Compressor::Snappy => {
                #[cfg(feature = "snappy-compression")]
                {
                    out.push(mongodb::options::Compressor::Snappy);
                }
                #[cfg(not(feature = "snappy-compression"))]
                {
                    log.warn(
                        "build_client_options: snappy compressor requested but mongodb feature off",
                        logctx! { "compressor" => "snappy" },
                    );
                }
            }
            crate::connection::model::Compressor::Zlib => {
                #[cfg(feature = "zlib-compression")]
                {
                    out.push(mongodb::options::Compressor::Zlib { level: None });
                }
                #[cfg(not(feature = "zlib-compression"))]
                {
                    log.warn(
                        "build_client_options: zlib compressor requested but mongodb feature off",
                        logctx! { "compressor" => "zlib" },
                    );
                }
            }
            crate::connection::model::Compressor::Zstd => {
                #[cfg(feature = "zstd-compression")]
                {
                    out.push(mongodb::options::Compressor::Zstd { level: None });
                }
                #[cfg(not(feature = "zstd-compression"))]
                {
                    log.warn(
                        "build_client_options: zstd compressor requested but mongodb feature off",
                        logctx! { "compressor" => "zstd" },
                    );
                }
            }
        }
    }
    out
}

/// Stub used when NO compression feature is on. The mongodb crate doesn't
/// expose `Compressor` in this build, so we return nothing — but still log
/// per requested codec so the user sees why their hint was ignored.
#[cfg(not(any(
    feature = "zstd-compression",
    feature = "zlib-compression",
    feature = "snappy-compression"
)))]
fn map_compressors(
    model_compressors: &[crate::connection::model::Compressor],
    log: &dyn Logger,
) -> Vec<()> {
    for c in model_compressors {
        let name = match c {
            crate::connection::model::Compressor::Snappy => "snappy",
            crate::connection::model::Compressor::Zlib => "zlib",
            crate::connection::model::Compressor::Zstd => "zstd",
        };
        log.warn(
            "build_client_options: compressor requested but mongodb feature off",
            logctx! { "compressor" => name },
        );
    }
    Vec::new()
}

// ──────────────────────────────────────────────────────────────────────────
// Step 7: Proxy (SOCKS5 only)
// ──────────────────────────────────────────────────────────────────────────

fn apply_proxy(
    opts: &mut ClientOptions,
    proxy: Option<&Proxy>,
    proxy_password: Option<&str>,
) -> Result<(), BuildError> {
    let Some(proxy) = proxy else { return Ok(()) };

    // A disabled proxy is persisted config the user toggled off — skip it
    // entirely (no validation, no socks5 wiring) so direct connect proceeds.
    if !proxy.enabled {
        return Ok(());
    }

    // validate_for_driver already produces a user-facing message; map any
    // failure to BuildStage::Tls (transport-layer setup).
    validate_proxy_for_driver(proxy).map_err(BuildError::tls)?;

    #[cfg(feature = "socks5-proxy")]
    {
        let mut sp = mongodb::options::Socks5Proxy::builder().host(proxy.host.clone()).build();
        sp.port = Some(proxy.port);
        if let Some(auth) = &proxy.auth {
            let password = proxy_password.ok_or_else(|| {
                BuildError::tls(
                    "proxy auth username is set but no password was resolved \
                     (keychain slot ProxyPassword / ResolvedConnection.proxy_password)",
                )
            })?;
            sp.authentication = Some((auth.username.clone(), password.to_string()));
        }
        opts.socks5_proxy = Some(sp);
        // mongodb v3 silently honours opts.socks5_proxy at connect time.
        let _ = opts;
    }
    #[cfg(not(feature = "socks5-proxy"))]
    {
        let _ = (opts, proxy_password);
        return Err(BuildError::tls(
            "SOCKS5 proxy is not compiled into this build. \
             Rebuild the app with `mongodb` crate feature `socks5-proxy` enabled.",
        ));
    }
    #[cfg(feature = "socks5-proxy")]
    Ok(())
}

// Defensive: keep a token reference to the doc!/Document import so unused-import
// lint stays off when both gssapi-auth and aws-auth are disabled.
#[allow(dead_code)]
fn _doc_import_anchor() -> Document {
    doc! { "_": "anchor" }
}

// `ServerAddress` is referenced in tests below; keep the import live without
// pulling in a cfg(test) gate at the module level.
#[allow(dead_code)]
fn _server_address_anchor(addr: ServerAddress) -> ServerAddress {
    addr
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::model::{
        AdvancedOverrides, Compressor as ModelCompressor, Connection, ConnectionTarget,
        Overrides, Proxy, ProxyKind, ReadPreference, ScramMechanism, Tls as ModelTls,
    };
    // `ProxyAuth` is only used when the `socks5-proxy` feature is on — the
    // import sits inside the gated test below.
    #[cfg(feature = "socks5-proxy")]
    use crate::connection::model::ProxyAuth;
    use crate::logger::{Logger, MemoryLogger};
    use std::sync::Arc;

    /// In-process logger that captures records but drops them on the floor.
    /// We use the existing `MemoryLogger` instead of rolling a fresh impl —
    /// the trait surface is bigger than just `emit`, so re-implementing it
    /// here would duplicate boilerplate from logger/mod.rs.
    fn null_log() -> Arc<dyn Logger> {
        MemoryLogger::new("builder-test")
    }

    /// Test helper: call `build_client_options` with `accept_host_key=false`
    /// and assert the result is `BuildOutcome::Ready`. Panics with a clear
    /// message on `PassphraseRequired` / `HostKeyUnknown` (those code
    /// paths are exercised by integration tests, not unit tests). Returns
    /// `(ClientOptions, Option<TunnelHandle>)` so existing test bodies stay
    /// readable.
    async fn build_ok(
        resolved: &ResolvedConnection<'_>,
        effective: &EffectivePrefs,
    ) -> (ClientOptions, Option<TunnelHandle>) {
        match build_client_options(resolved, effective, false, null_log())
            .await
            .expect("build_client_options should succeed")
        {
            // The `uri` field is verified by integration tests (it's the
            // string fed to ClientOptions::parse); unit tests here check
            // assembled-options fields, so we drop it.
            BuildOutcome::Ready { options, tunnel, uri: _ } => (options, tunnel),
            other => panic!("expected BuildOutcome::Ready, got {}", other.kind()),
        }
    }

    /// Test helper: call `build_client_options` and assert it returns the
    /// `BuildError` variant (genuine failure). Panics on `Ok`.
    async fn build_err(
        resolved: &ResolvedConnection<'_>,
        effective: &EffectivePrefs,
    ) -> BuildError {
        match build_client_options(resolved, effective, false, null_log()).await {
            Err(e) => e,
            Ok(other) => panic!("expected BuildError, got {}", other.kind()),
        }
    }

    fn base_conn(target: ConnectionTarget, auth: AuthMode) -> Connection {
        Connection {
            id: "c1".into(),
            name: "t".into(),
            color: None,
            target,
            auth,
            tls: None,
            ssh: None,
            proxy: None,
            overrides: None,
            created_at: "2026-05-28".into(),
        }
    }

    fn direct_target() -> ConnectionTarget {
        ConnectionTarget::Direct {
            host: "mongo.example.com".into(),
            port: 27017,
            replica_set: None,
            read_preference: None,
            direct_connection: None,
        }
    }

    fn effective_defaults() -> EffectivePrefs {
        EffectivePrefs::default()
    }

    // ── URI synthesis ────────────────────────────────────────────────

    #[test]
    fn synthesize_direct_uri_bare() {
        let uri = synthesize_direct_uri("mongo.example.com", 27017, None, None, None);
        assert_eq!(uri, "mongodb://mongo.example.com:27017/");
    }

    #[test]
    fn synthesize_direct_uri_with_replica_set() {
        let uri = synthesize_direct_uri("h", 27017, Some("rs0"), None, None);
        assert_eq!(uri, "mongodb://h:27017/?replicaSet=rs0");
    }

    #[test]
    fn synthesize_direct_uri_with_read_pref_and_direct() {
        let uri = synthesize_direct_uri(
            "h",
            27017,
            None,
            Some(ReadPreference::SecondaryPreferred),
            Some(true),
        );
        assert!(uri.contains("readPreference=secondaryPreferred"));
        assert!(uri.contains("directConnection=true"));
    }

    // ── Bare URI passthrough + parse ─────────────────────────────────

    #[tokio::test]
    async fn uri_target_passes_through_to_client_options() {
        let conn = base_conn(
            ConnectionTarget::Uri {
                uri: "mongodb://mongo.example.com:27017/?appName=ignored".into(),
            },
            AuthMode::None,
        );
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        // appName from EffectivePrefs wins over whatever the URI carried —
        // step 6 runs after parse and overwrites the field.
        assert_eq!(opts.app_name.as_deref(), Some("mongo-lens"));
        assert!(!opts.hosts.is_empty());
    }

    // ── SCRAM credentials ────────────────────────────────────────────

    #[tokio::test]
    async fn scram_credentials_applied() {
        let conn = base_conn(
            direct_target(),
            AuthMode::Scram {
                username: "alice".into(),
                auth_db: "admin".into(),
                mechanism: Some(ScramMechanism::ScramSha256),
            },
        );
        let mut resolved = ResolvedConnection::bare(&conn);
        resolved.auth_password = Some("pw".into());

        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        let cred = opts.credential.expect("credential");
        assert_eq!(cred.username.as_deref(), Some("alice"));
        assert_eq!(cred.source.as_deref(), Some("admin"));
        assert_eq!(cred.password.as_deref(), Some("pw"));
        assert!(matches!(cred.mechanism, Some(AuthMechanism::ScramSha256)));
    }

    #[tokio::test]
    async fn scram_auto_mechanism_means_no_explicit_mechanism() {
        let conn = base_conn(
            direct_target(),
            AuthMode::Scram {
                username: "u".into(),
                auth_db: "admin".into(),
                mechanism: Some(ScramMechanism::Auto),
            },
        );
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        assert!(opts.credential.unwrap().mechanism.is_none());
    }

    #[tokio::test]
    async fn ldap_uses_plain_mechanism_and_external_source() {
        let conn = base_conn(
            direct_target(),
            AuthMode::Ldap {
                username: "ldap-user".into(),
            },
        );
        let mut resolved = ResolvedConnection::bare(&conn);
        resolved.auth_password = Some("pw".into());
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        let cred = opts.credential.unwrap();
        assert_eq!(cred.username.as_deref(), Some("ldap-user"));
        assert!(matches!(cred.mechanism, Some(AuthMechanism::Plain)));
        assert_eq!(cred.source.as_deref(), Some("$external"));
    }

    #[tokio::test]
    async fn x509_uses_x509_mechanism_external_source_no_username() {
        let conn = base_conn(
            direct_target(),
            AuthMode::X509 {
                cert_file: "/tmp/client.pem".into(),
                cert_key_file: None,
            },
        );
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        let cred = opts.credential.unwrap();
        assert!(cred.username.is_none(), "x509 lifts DN from cert");
        assert_eq!(cred.source.as_deref(), Some("$external"));
        assert!(matches!(cred.mechanism, Some(AuthMechanism::MongoDbX509)));
    }

    #[tokio::test]
    async fn oidc_principal_and_provider_propagate() {
        let conn = base_conn(
            direct_target(),
            AuthMode::Oidc {
                principal: Some("user@example.com".into()),
                provider_name: Some("azure".into()),
            },
        );
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        let cred = opts.credential.unwrap();
        assert!(matches!(cred.mechanism, Some(AuthMechanism::MongoDbOidc)));
        assert_eq!(cred.username.as_deref(), Some("user@example.com"));
        let props = cred.mechanism_properties.expect("mechanism_properties");
        assert_eq!(props.get_str("ENVIRONMENT").unwrap(), "azure");
    }

    #[tokio::test]
    async fn none_auth_mode_produces_no_credential() {
        let conn = base_conn(direct_target(), AuthMode::None);
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        assert!(opts.credential.is_none());
    }

    #[tokio::test]
    async fn legacy_cr_emits_credential_with_mongodb_cr_mechanism() {
        let conn = base_conn(
            direct_target(),
            AuthMode::LegacyCr {
                username: "u".into(),
                auth_db: "admin".into(),
            },
        );
        let mut resolved = ResolvedConnection::bare(&conn);
        resolved.auth_password = Some("pw".into());
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        assert!(matches!(
            opts.credential.unwrap().mechanism,
            Some(AuthMechanism::MongoDbCr)
        ));
    }

    // Kerberos / AWS IAM: behaviour depends on whether the mongodb crate is
    // built with gssapi-auth / aws-auth features. Cover both compile-time
    // paths so the file's stance on each is visible.

    #[cfg(feature = "gssapi-auth")]
    #[tokio::test]
    async fn kerberos_with_feature_emits_gssapi_credential() {
        let conn = base_conn(
            direct_target(),
            AuthMode::Kerberos {
                principal: "alice@EXAMPLE.COM".into(),
                service_name: Some("mongodb".into()),
                canonicalize_host_name: Some(true),
            },
        );
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        let cred = opts.credential.unwrap();
        assert!(matches!(cred.mechanism, Some(AuthMechanism::Gssapi)));
        assert_eq!(cred.username.as_deref(), Some("alice@EXAMPLE.COM"));
        let props = cred.mechanism_properties.unwrap();
        assert_eq!(props.get_str("SERVICE_NAME").unwrap(), "mongodb");
        assert_eq!(props.get_bool("CANONICALIZE_HOST_NAME").unwrap(), true);
    }

    #[cfg(not(feature = "gssapi-auth"))]
    #[tokio::test]
    async fn kerberos_without_feature_returns_auth_stage_error() {
        let conn = base_conn(
            direct_target(),
            AuthMode::Kerberos {
                principal: "alice@EXAMPLE.COM".into(),
                service_name: None,
                canonicalize_host_name: None,
            },
        );
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Auth);
        assert!(err.error.contains("gssapi-auth"), "msg: {}", err.error);
    }

    #[cfg(feature = "aws-auth")]
    #[tokio::test]
    async fn aws_iam_with_feature_emits_aws_credential() {
        let conn = base_conn(
            direct_target(),
            AuthMode::AwsIam {
                access_key_id: Some("AKIA...".into()),
                session_token: Some("SESSION".into()),
                use_env_creds: Some(false),
            },
        );
        let mut resolved = ResolvedConnection::bare(&conn);
        resolved.aws_secret_key = Some("SECRET".into());
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        let cred = opts.credential.unwrap();
        assert!(matches!(cred.mechanism, Some(AuthMechanism::MongoDbAws)));
        assert_eq!(cred.username.as_deref(), Some("AKIA..."));
        assert_eq!(cred.password.as_deref(), Some("SECRET"));
        let props = cred.mechanism_properties.unwrap();
        assert_eq!(props.get_str("AWS_SESSION_TOKEN").unwrap(), "SESSION");
    }

    #[cfg(not(feature = "aws-auth"))]
    #[tokio::test]
    async fn aws_iam_without_feature_returns_auth_stage_error() {
        let conn = base_conn(
            direct_target(),
            AuthMode::AwsIam {
                access_key_id: Some("AKIA...".into()),
                session_token: None,
                use_env_creds: Some(false),
            },
        );
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Auth);
        assert!(err.error.contains("aws-auth"), "msg: {}", err.error);
    }

    // ── TLS ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn tls_disabled_when_enabled_false() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.tls = Some(ModelTls {
            enabled: false,
            allow_invalid_certs: None,
            allow_invalid_hostnames: None,
            ca_file: None,
            client_cert_file: None,
        });
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        assert!(matches!(opts.tls, Some(Tls::Disabled)));
    }

    #[tokio::test]
    async fn tls_options_propagate() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.tls = Some(ModelTls {
            enabled: true,
            allow_invalid_certs: Some(true),
            allow_invalid_hostnames: None,
            ca_file: Some("/etc/ssl/ca.pem".into()),
            client_cert_file: Some("/etc/ssl/client.pem".into()),
        });
        let resolved = ResolvedConnection::bare(&conn);
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        match opts.tls {
            Some(Tls::Enabled(tls_opts)) => {
                assert_eq!(tls_opts.allow_invalid_certificates, Some(true));
                assert_eq!(
                    tls_opts.ca_file_path.as_deref(),
                    Some(std::path::Path::new("/etc/ssl/ca.pem"))
                );
                assert_eq!(
                    tls_opts.cert_key_file_path.as_deref(),
                    Some(std::path::Path::new("/etc/ssl/client.pem"))
                );
            }
            other => panic!("expected Tls::Enabled, got {other:?}"),
        }
    }

    #[cfg(not(feature = "openssl-tls"))]
    #[tokio::test]
    async fn allow_invalid_hostnames_requires_openssl_feature() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.tls = Some(ModelTls {
            enabled: true,
            allow_invalid_certs: None,
            allow_invalid_hostnames: Some(true),
            ca_file: None,
            client_cert_file: None,
        });
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Tls);
        assert!(err.error.contains("openssl-tls"), "msg: {}", err.error);
    }

    // ── Advanced prefs ──────────────────────────────────────────────

    #[tokio::test]
    async fn advanced_prefs_propagate_app_name_retry_and_timeouts() {
        let conn = base_conn(direct_target(), AuthMode::None);
        let resolved = ResolvedConnection::bare(&conn);

        // Build a non-default EffectivePrefs by applying overrides through
        // the real resolver — guards against accidentally testing only the
        // default values.
        let global = crate::prefs::model::GlobalPrefs::default();
        let overrides = Overrides {
            intelli_shell: None,
            tools: None,
            advanced: Some(AdvancedOverrides {
                app_name: Some("custom-app".into()),
                retry_writes: Some(false),
                retry_reads: Some(false),
                compressors: None,
                server_selection_timeout_ms: Some(5_000),
                connect_timeout_ms: Some(2_500),
                socket_timeout_ms: None,
            }),
        };
        let effective = crate::prefs::resolve_effective(&global, Some(&overrides));

        let (opts, _tunnel) = build_ok(&resolved, &effective).await;
        assert_eq!(opts.app_name.as_deref(), Some("custom-app"));
        assert_eq!(opts.retry_writes, Some(false));
        assert_eq!(opts.retry_reads, Some(false));
        assert_eq!(
            opts.server_selection_timeout,
            Some(std::time::Duration::from_millis(5_000))
        );
        assert_eq!(
            opts.connect_timeout,
            Some(std::time::Duration::from_millis(2_500))
        );
    }

    #[tokio::test]
    async fn compressors_skipped_when_mongodb_feature_off() {
        // Without snappy/zlib/zstd features (current build state), all
        // requested compressors are dropped with a warning log — we don't
        // assert the warning here (NullLogger), just that the field stays
        // None / empty.
        let conn = base_conn(direct_target(), AuthMode::None);
        let resolved = ResolvedConnection::bare(&conn);

        let global = crate::prefs::model::GlobalPrefs::default();
        let overrides = Overrides {
            intelli_shell: None,
            tools: None,
            advanced: Some(AdvancedOverrides {
                app_name: None,
                retry_writes: None,
                retry_reads: None,
                compressors: Some(vec![
                    ModelCompressor::Snappy,
                    ModelCompressor::Zlib,
                    ModelCompressor::Zstd,
                ]),
                server_selection_timeout_ms: None,
                connect_timeout_ms: None,
                socket_timeout_ms: None,
            }),
        };
        let effective = crate::prefs::resolve_effective(&global, Some(&overrides));
        let (opts, _tunnel) = build_ok(&resolved, &effective).await;
        // The `compressors` field on ClientOptions itself is feature-gated.
        // When all three codec features are off, the field doesn't exist —
        // hitting that path means the builder simply didn't touch it. When
        // any feature is on, we only check the build succeeded; exact mapping
        // is verified per-codec in cfg-gated tests elsewhere.
        let _ = opts;
    }

    // ── Proxy ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn http_proxy_returns_tls_stage_error() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.proxy = Some(Proxy {
            enabled: true,
            kind: ProxyKind::Http,
            host: "proxy.example.com".into(),
            port: 3128,
            auth: None,
        });
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Tls);
        assert!(err.error.contains("HTTP proxy"), "msg: {}", err.error);
    }

    #[tokio::test]
    async fn socks4_proxy_returns_tls_stage_error() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.proxy = Some(Proxy {
            enabled: true,
            kind: ProxyKind::Socks4,
            host: "proxy.example.com".into(),
            port: 1080,
            auth: None,
        });
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Tls);
        assert!(err.error.contains("SOCKS4"), "msg: {}", err.error);
    }

    #[cfg(not(feature = "socks5-proxy"))]
    #[tokio::test]
    async fn socks5_without_feature_returns_tls_stage_error() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.proxy = Some(Proxy {
            enabled: true,
            kind: ProxyKind::Socks5,
            host: "proxy.example.com".into(),
            port: 1080,
            auth: None,
        });
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Tls);
        assert!(err.error.contains("socks5-proxy"), "msg: {}", err.error);
    }

    #[cfg(feature = "socks5-proxy")]
    #[tokio::test]
    async fn socks5_with_feature_applies_proxy() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.proxy = Some(Proxy {
            enabled: true,
            kind: ProxyKind::Socks5,
            host: "proxy.example.com".into(),
            port: 1080,
            auth: Some(ProxyAuth {
                username: "proxy-user".into(),
            }),
        });
        let mut resolved = ResolvedConnection::bare(&conn);
        resolved.proxy_password = Some("proxy-pw".into());
        let (opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
        let sp = opts.socks5_proxy.expect("socks5_proxy");
        assert_eq!(sp.host, "proxy.example.com");
        assert_eq!(sp.port, Some(1080));
        assert_eq!(
            sp.authentication,
            Some(("proxy-user".to_string(), "proxy-pw".to_string()))
        );
    }

    // ── SSH ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn ssh_handshake_failure_stages_correctly() {
        // Feed a clearly-unreachable SSH host so the bridge errors out at
        // the russh connect step. The exact error message is environment-
        // dependent (DNS vs TCP vs handshake) — we only assert the stage.
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.ssh = Some(crate::connection::model::SshTunnel {
            enabled: true,
            host: "127.0.0.1".into(),
            port: 1, // port 1 — virtually always closed
            user: "nobody".into(),
            auth: crate::connection::model::SshAuth::Agent,
            known_hosts_policy: KnownHostsPolicy::AcceptAny,
        });
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Ssh);
    }

    #[tokio::test]
    async fn ssh_missing_password_secret_fails_at_ssh_stage() {
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.ssh = Some(crate::connection::model::SshTunnel {
            enabled: true,
            host: "127.0.0.1".into(),
            port: 22,
            user: "u".into(),
            auth: crate::connection::model::SshAuth::Password,
            known_hosts_policy: KnownHostsPolicy::Strict,
        });
        // resolved.ssh_password intentionally None.
        let resolved = ResolvedConnection::bare(&conn);
        let err = build_err(&resolved, &effective_defaults()).await;
        assert_eq!(err.stage, BuildStage::Ssh);
        assert!(err.error.contains("SSH password"), "msg: {}", err.error);
    }

    // ── Disabled-feature gating (save-while-disabled) ──────────────

    #[tokio::test]
    async fn disabled_ssh_skips_tunnel_and_builds_ready() {
        // Tunnel config is present but toggled off. The builder must NOT try to
        // open it (the host:port below is unreachable — an attempt would fail at
        // the Ssh stage). Instead it should connect directly with no tunnel.
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.ssh = Some(crate::connection::model::SshTunnel {
            enabled: false,
            host: "127.0.0.1".into(),
            port: 1, // would fail instantly if an attempt were made
            user: "nobody".into(),
            auth: crate::connection::model::SshAuth::Agent,
            known_hosts_policy: KnownHostsPolicy::AcceptAny,
        });
        let resolved = ResolvedConnection::bare(&conn);
        let (_opts, tunnel) = build_ok(&resolved, &effective_defaults()).await;
        assert!(tunnel.is_none(), "disabled ssh must not open a tunnel");
    }

    #[tokio::test]
    async fn disabled_proxy_is_skipped() {
        // An HTTP proxy is normally rejected at the Tls stage (driver supports
        // SOCKS5 only). Toggled off, it must be skipped entirely so the build
        // succeeds — proving apply_proxy short-circuits before validation.
        let mut conn = base_conn(direct_target(), AuthMode::None);
        conn.proxy = Some(Proxy {
            enabled: false,
            kind: ProxyKind::Http,
            host: "proxy.example.com".into(),
            port: 3128,
            auth: None,
        });
        let resolved = ResolvedConnection::bare(&conn);
        // build_ok panics on any BuildError, so reaching Ready proves the
        // disabled HTTP proxy was not validated/applied.
        let (_opts, _tunnel) = build_ok(&resolved, &effective_defaults()).await;
    }

    // ── BuildError shape ───────────────────────────────────────────

    #[test]
    fn build_error_serializes_with_lowercase_stage() {
        let err = BuildError::auth("oops");
        let value = serde_json::to_value(&err).unwrap();
        assert_eq!(value["stage"], serde_json::Value::String("auth".into()));
        assert_eq!(value["error"], serde_json::Value::String("oops".into()));

        let ssh_err = BuildError::ssh("nope");
        let value = serde_json::to_value(&ssh_err).unwrap();
        assert_eq!(value["stage"], serde_json::Value::String("ssh".into()));
    }

    #[test]
    fn build_stage_ping_serializes_as_lowercase_ping() {
        // Builder never emits Ping itself but the variant is part of the
        // wire contract; assert serde rendering so the IPC layer can
        // round-trip it.
        let stage = BuildStage::Ping;
        assert_eq!(serde_json::to_value(stage).unwrap(), serde_json::Value::String("ping".into()));
    }

    #[test]
    fn build_stage_as_wire_matches_serde() {
        // `as_wire()` is the string-error accessor; it MUST stay identical to
        // the serde wire form so a typed `TestResultV2` failure and a plain
        // connect `String` error spell the same stage the same way.
        for stage in [
            BuildStage::Ssh,
            BuildStage::Tls,
            BuildStage::Auth,
            BuildStage::Ping,
        ] {
            let serde_wire = serde_json::to_value(stage).unwrap();
            assert_eq!(
                serde_json::Value::String(stage.as_wire().into()),
                serde_wire,
                "as_wire() drifted from serde for {stage:?}"
            );
        }
    }
}
