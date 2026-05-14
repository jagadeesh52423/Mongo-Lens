use std::fmt;
use std::io;
use std::path::PathBuf;

/// All SSH-layer errors. Use `Display` for user-facing messages.
/// The command layer maps specific variants to structured `ConnectOutcome` values
/// (PassphraseRequired, HostKeyUnknown) rather than surfacing them as error strings.
#[derive(Debug)]
pub enum SshError {
    /// Key file path was not found on disk.
    KeyFileNotFound(PathBuf),
    /// Key file exists but could not be read or parsed.
    KeyFileUnreadable(io::Error),
    /// Key file permissions are too open (group/other readable or writable).
    /// ssh(1) also refuses such keys; we match that behaviour.
    KeyFilePermissionsTooOpen { path: PathBuf, mode: u32 },
    /// Key file is encrypted and no passphrase was supplied.
    PassphraseRequired,
    /// Supplied passphrase did not decrypt the key.
    PassphraseIncorrect,
    /// Server rejected the credentials.
    AuthFailed(String),
    /// Host key is known but has changed — possible MITM, never auto-override.
    HostKeyChanged {
        host: String,
        stored_source: &'static str,
    },
    /// TCP connection to the SSH host timed out.
    ConnectTimeout,
    /// SSH protocol handshake failed.
    SshHandshake(String),
    /// Failed to bind the local TCP listener.
    LocalBind(io::Error),
    /// URI rewriting failed.
    UriRewrite(String),
    /// `mongodb+srv://` URIs are not supported with SSH tunneling.
    SrvNotSupported,
    /// Multi-seed `mongodb://` URIs are not supported with SSH tunneling.
    MultiSeedNotSupported,
    /// Internal / environment error (e.g. missing HOME var, unexpected I/O).
    Internal(String),
}

impl fmt::Display for SshError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SshError::KeyFileNotFound(p) => write!(
                f,
                "SSH key file not found: {}. Check the path in your connection settings.",
                p.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| p.display().to_string())
            ),
            SshError::KeyFileUnreadable(e) => {
                write!(f, "Could not read SSH key file: {e}")
            }
            SshError::KeyFilePermissionsTooOpen { path, mode } => write!(
                f,
                "SSH key file '{}' has permissions {:04o} — group/other access is set. \
                 chmod 600 the file to fix this (ssh also refuses such keys).",
                path.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.display().to_string()),
                mode & 0o777
            ),
            SshError::PassphraseRequired => write!(
                f,
                "The SSH key is encrypted. Please provide the passphrase."
            ),
            SshError::PassphraseIncorrect => {
                write!(f, "The passphrase is incorrect. Please try again.")
            }
            SshError::AuthFailed(reason) => {
                write!(f, "SSH authentication failed: {reason}")
            }
            SshError::HostKeyChanged {
                host,
                stored_source,
            } => write!(
                f,
                "WARNING: The host key for {host} does not match the one stored in {stored_source}. \
                 Connection refused to protect against possible man-in-the-middle attack."
            ),
            SshError::ConnectTimeout => write!(
                f,
                "Timed out connecting to the SSH server. Check the host and port."
            ),
            SshError::SshHandshake(msg) => {
                write!(f, "SSH handshake failed: {msg}")
            }
            SshError::LocalBind(e) => {
                write!(f, "Could not open a local port for the SSH tunnel: {e}")
            }
            SshError::UriRewrite(msg) => {
                write!(f, "Could not rewrite the MongoDB URI for tunneling: {msg}")
            }
            SshError::SrvNotSupported => write!(
                f,
                "SRV (mongodb+srv://) URIs are not supported with SSH tunneling in this version. \
                 SRV records resolve hostnames that the SSH server may not be able to reach. \
                 Use mongodb:// with a single explicit host instead."
            ),
            SshError::MultiSeedNotSupported => write!(
                f,
                "Replica-set seedlists are not supported with SSH tunneling in this version. \
                 Specify a single host (mongodb://host:port/db) instead of a comma-separated list."
            ),
            SshError::Internal(msg) => {
                write!(f, "SSH internal error: {msg}")
            }
        }
    }
}

impl std::error::Error for SshError {}
