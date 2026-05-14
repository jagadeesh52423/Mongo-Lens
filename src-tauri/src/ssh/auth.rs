use crate::db::connections::ConnectionRecord;
use crate::ssh::errors::SshError;
use russh::client::Handle;
use zeroize::Zeroizing;

use super::host_key::HostKeyVerifier;

/// Collects per-connection authentication secrets passed down from the command layer.
///
/// Using a single struct means adding a new auth variant (password, agent socket, OTP, …)
/// requires only a new field here — `AuthMethodFactory::build` and all callers are unchanged.
/// Implement this interface to add a new SSH auth variant.
#[derive(Clone)]
pub struct AuthSecrets {
    /// Private-key passphrase (used by `KeyFileAuth`).
    pub passphrase: Option<Zeroizing<String>>,
    // Future fields: password, agent_socket, otp, etc.
}

impl AuthSecrets {
    /// Construct from raw strings at the IPC boundary.
    /// Wraps the passphrase in `Zeroizing` so heap memory is wiped on drop.
    pub fn new(passphrase: Option<String>) -> Self {
        Self {
            passphrase: passphrase.map(Zeroizing::new),
        }
    }

}

/// Implement this trait to add a new SSH auth variant (e.g., agent, password, OTP).
/// Register the corresponding factory in `registry()` below — no other code changes needed.
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

/// A factory that attempts to build an `AuthMethod` from a `ConnectionRecord`.
/// Returns `None` if this factory's preconditions are not met (e.g., no key path configured).
///
/// Implement this trait and add an entry to `registry()` to add a new auth variant.
pub trait AuthMethodFactory: Send + Sync {
    fn build(
        &self,
        rec: &ConnectionRecord,
        secrets: &AuthSecrets,
    ) -> Option<Box<dyn AuthMethod>>;
}

/// Registered auth method factories. The first factory that returns `Some` wins.
/// To add a new variant: implement `AuthMethod` + `AuthMethodFactory` and add one line here.
pub fn registry() -> &'static [&'static dyn AuthMethodFactory] {
    static REG: &[&dyn AuthMethodFactory] = &[&crate::ssh::auth_key::KeyFileAuthFactory];
    REG
}

/// Try each factory in `registry()` in order. Returns the first method that matches,
/// or an error if no factory can handle the given record.
pub fn build_auth_method(
    rec: &ConnectionRecord,
    secrets: &AuthSecrets,
) -> Result<Box<dyn AuthMethod>, SshError> {
    for factory in registry() {
        if let Some(method) = factory.build(rec, secrets) {
            return Ok(method);
        }
    }
    Err(SshError::AuthFailed(
        "No supported SSH authentication method found. \
         Configure an SSH key path in the connection settings."
            .into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connections::ConnectionRecord;

    fn rec_with_key(path: &str) -> ConnectionRecord {
        ConnectionRecord {
            id: "1".into(),
            name: "t".into(),
            host: Some("localhost".into()),
            port: Some(27017),
            auth_db: Some("admin".into()),
            username: Some("u".into()),
            conn_string: None,
            ssh_host: Some("bastion.example.com".into()),
            ssh_port: Some(22),
            ssh_user: Some("ubuntu".into()),
            ssh_key_path: Some(path.into()),
            created_at: "2026-05-14".into(),
        }
    }

    fn rec_no_key() -> ConnectionRecord {
        let mut r = rec_with_key("");
        r.ssh_key_path = None;
        r
    }

    #[test]
    fn registry_is_non_empty() {
        assert!(!registry().is_empty(), "at least one auth factory must be registered");
    }

    #[test]
    fn build_auth_method_errors_when_no_factory_matches() {
        let result = build_auth_method(&rec_no_key(), &AuthSecrets::new(None));
        assert!(result.is_err());
        // `.err().unwrap()` avoids `unwrap_err()` which requires T: Debug.
        let msg = result.err().unwrap().to_string();
        assert!(msg.contains("No supported SSH authentication method"), "unexpected: {msg}");
    }

    #[test]
    fn build_auth_method_succeeds_with_key_path() {
        // Factory returns Ok even for a non-existent path — existence is checked at auth time.
        let result = build_auth_method(&rec_with_key("/tmp/id_ed25519"), &AuthSecrets::new(None));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id(), "key");
    }

    #[test]
    fn auth_secrets_wraps_passphrase_in_zeroizing() {
        let s = AuthSecrets::new(Some("hunter2".into()));
        assert_eq!(s.passphrase.as_ref().map(|z| z.as_str()), Some("hunter2"));
    }

    #[test]
    fn auth_secrets_empty_has_no_passphrase() {
        assert!(AuthSecrets::new(None).passphrase.is_none());
    }
}
