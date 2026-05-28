use crate::ssh::auth::AuthMethod;
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
    /// Direct constructor used by `connection::tunnel::resolve_auth`.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_method_id_is_password() {
        let auth = PasswordAuth::new("pw".into());
        assert_eq!(auth.id(), "password");
    }
}
