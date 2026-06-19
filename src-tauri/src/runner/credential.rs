use zeroize::{Zeroize, ZeroizeOnDrop};

/// Structured credential the Node query runner needs to authenticate with
/// MongoDB. Written to the child's stdin (never env vars — those are readable by
/// same-user processes via `ps -E` / `/proc`).
///
/// Derive `Clone` so it can be stored in `AppState::mongo_runner_creds` and
/// cloned out at query time. Do NOT derive `Serialize` — the password must
/// never appear in logs, IPC traces, or JSON payloads. `ZeroizeOnDrop` scrubs
/// the secret bytes when any copy (the stored one or a clone) is dropped, so a
/// password does not linger in freed heap memory.
///
/// # Lifecycle
/// Inserted into `AppState::mongo_runner_creds` on connect (alongside
/// `mongo_uris`) and removed on disconnect / SSH session loss. A credential
/// never outlives its corresponding URI entry.
#[derive(Debug, Clone, Zeroize, ZeroizeOnDrop)]
pub struct RunnerCredential {
    /// Empty for cert-based modes (X509) where the driver lifts the identity
    /// from the TLS-presented client certificate.
    pub username: String,
    pub password: Option<String>,
    pub auth_source: Option<String>,
    /// Driver wire token, e.g. `"SCRAM-SHA-256"`, `"PLAIN"`, `"MONGODB-X509"`.
    /// `None` means "let the Node driver negotiate".
    pub mechanism: Option<String>,
    /// Resolved TLS material the harness must apply to match the Rust driver
    /// (client cert for X509, custom CA, allow-invalid flags). `None` when the
    /// connection has no TLS. Not a secret — file paths/flags only — so it is
    /// skipped by zeroize.
    #[zeroize(skip)]
    pub tls: Option<RunnerTls>,
}

/// TLS settings the harness needs to reproduce the Rust driver's connection.
/// All non-secret (paths + flags); mirrors `connection::model::Tls` projected
/// to what the Node driver accepts (`tlsCertificateKeyFile`, `tlsCAFile`, ...).
#[derive(Debug, Clone)]
pub struct RunnerTls {
    /// Combined client cert+key file (`tlsCertificateKeyFile`). Required for
    /// X509; optional otherwise.
    pub cert_key_file: Option<String>,
    pub ca_file: Option<String>,
    pub allow_invalid_certs: bool,
    pub allow_invalid_hostnames: bool,
}
