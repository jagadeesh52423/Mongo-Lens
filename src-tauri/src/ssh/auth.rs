use crate::ssh::errors::SshError;
use russh::client::Handle;

use super::host_key::HostKeyVerifier;

/// Implement this trait to add a new SSH auth variant (key, password,
/// agent). Instantiate the impl directly at the call site
/// (see [`crate::connection::tunnel::resolve_auth`]) — there is no
/// runtime registry; the v2 model's `SshAuth` tagged union enumerates the
/// supported variants and dispatches at the bridge layer.
pub trait AuthMethod: Send + Sync {
    /// Stable identifier for logging ("key", "password", "agent").
    fn id(&self) -> &'static str;

    /// Drive the russh client through authentication.
    /// Returns `Ok(())` on success, `SshError` otherwise.
    fn authenticate<'a>(
        &'a self,
        handle: &'a mut Handle<HostKeyVerifier>,
        user: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), SshError>> + Send + 'a>>;
}
