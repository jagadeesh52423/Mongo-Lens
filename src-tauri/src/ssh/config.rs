use crate::ssh::auth::AuthMethod;

/// All parameters needed to open an SSH tunnel.
///
/// Constructed by the v2 `connection::tunnel` bridge from the tagged-union
/// `SshTunnel` model and a resolved-secrets bag, then handed to
/// `ssh::open_tunnel`. The legacy `ConnectionRecord`-based constructor
/// was removed along with the legacy IPC surface.
pub struct SshConfig {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    /// Authentication strategy (resolved from the connection model).
    pub auth: Box<dyn AuthMethod>,
    /// MongoDB host as seen from the SSH server side.
    pub target_host: String,
    /// MongoDB port as seen from the SSH server side.
    pub target_port: u16,
}
