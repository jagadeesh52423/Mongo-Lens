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
    pub username: String,
    pub password: Option<String>,
    pub auth_source: Option<String>,
    /// Driver wire token, e.g. `"SCRAM-SHA-256"` or `"PLAIN"`.
    /// `None` means "let the Node driver negotiate".
    pub mechanism: Option<String>,
}
