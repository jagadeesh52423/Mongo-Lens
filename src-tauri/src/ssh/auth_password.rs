use crate::db::connections::ConnectionRecord;
use crate::ssh::auth::{AuthMethod, AuthMethodFactory, AuthSecrets};
use crate::ssh::errors::SshError;
use crate::ssh::host_key::HostKeyVerifier;
use russh::client::{AuthResult, Handle};
use zeroize::Zeroizing;

/// SSH password authentication. Dispatches to russh's `authenticate_password`.
///
/// The password is held in `Zeroizing` so its heap memory is wiped on drop. We only
/// borrow `&str` into russh for the duration of the call — russh internally turns it
/// into an owned `String` and that copy is outside our zeroization scope, but the
/// in-process lifetime of the credential is minimised.
pub struct PasswordAuth {
    password: Zeroizing<String>,
}

impl PasswordAuth {
    /// Direct constructor for callers that resolve the password outside the legacy
    /// `ConnectionRecord` flow (e.g. the new `connection::tunnel` bridge).
    pub fn new(password: String) -> Self {
        Self {
            password: Zeroizing::new(password),
        }
    }
}

impl AuthMethod for PasswordAuth {
    fn id(&self) -> &'static str {
        "password"
    }

    fn authenticate<'a>(
        &'a self,
        handle: &'a mut Handle<HostKeyVerifier>,
        user: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), SshError>> + Send + 'a>>
    {
        Box::pin(async move {
            let result = handle
                .authenticate_password(user, self.password.as_str())
                .await
                .map_err(|e| SshError::SshHandshake(e.to_string()))?;
            match result {
                AuthResult::Success => Ok(()),
                AuthResult::Failure { partial_success: true, .. } => Err(SshError::AuthFailed(
                    "Server requires additional authentication methods (partial success). \
                     Multi-factor SSH auth is not supported in this version."
                        .into(),
                )),
                AuthResult::Failure { .. } => Err(SshError::AuthFailed(
                    "Server rejected the SSH password. Check the username and password."
                        .into(),
                )),
            }
        })
    }
}

/// Factory for `PasswordAuth`. Returns `Some` only when an SSH password is present in
/// `AuthSecrets` *and* no key path was configured on the connection record — keeps the
/// key-file path strictly higher precedence (matches plan §Task 7 step 3).
///
/// Implement this trait pattern to add a new SSH auth variant — see `auth.rs::registry()`.
pub struct PasswordAuthFactory;

impl AuthMethodFactory for PasswordAuthFactory {
    fn build(
        &self,
        rec: &ConnectionRecord,
        secrets: &AuthSecrets,
    ) -> Option<Box<dyn AuthMethod>> {
        let has_key_path = rec
            .ssh_key_path
            .as_ref()
            .is_some_and(|p| !p.is_empty());
        if has_key_path {
            return None;
        }
        secrets.ssh_password.as_ref().map(|password| {
            Box::new(PasswordAuth {
                password: password.clone(),
            }) as Box<dyn AuthMethod>
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec_no_key() -> ConnectionRecord {
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
            ssh_key_path: None,
            created_at: "2026-05-14".into(),
        }
    }

    fn rec_with_key() -> ConnectionRecord {
        let mut rec = rec_no_key();
        rec.ssh_key_path = Some("/tmp/id_ed25519".into());
        rec
    }

    #[test]
    fn factory_returns_some_when_password_set_and_no_key_path() {
        let secrets = AuthSecrets::with_password("pw".into());
        assert!(PasswordAuthFactory.build(&rec_no_key(), &secrets).is_some());
    }

    #[test]
    fn factory_returns_none_when_password_unset() {
        let secrets = AuthSecrets::default();
        assert!(PasswordAuthFactory.build(&rec_no_key(), &secrets).is_none());
    }

    #[test]
    fn factory_yields_to_key_when_key_path_present() {
        // Even if a password is supplied, the legacy key path on the record wins.
        let secrets = AuthSecrets::with_password("pw".into());
        assert!(PasswordAuthFactory.build(&rec_with_key(), &secrets).is_none());
    }

    #[test]
    fn auth_method_id_is_password() {
        let auth = PasswordAuth {
            password: Zeroizing::new("pw".into()),
        };
        assert_eq!(auth.id(), "password");
    }
}
