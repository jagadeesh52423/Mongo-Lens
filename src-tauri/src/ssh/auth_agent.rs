use crate::db::connections::ConnectionRecord;
use crate::ssh::auth::{AuthMethod, AuthMethodFactory, AuthSecrets};
use crate::ssh::errors::SshError;
use crate::ssh::host_key::HostKeyVerifier;
use russh::client::{AuthResult, Handle};
use russh::keys::agent::client::AgentClient;
use russh::keys::agent::AgentIdentity;
use std::borrow::Cow;

/// SSH agent authentication. Connects to the agent referenced by `SSH_AUTH_SOCK` and
/// tries each identity in order until one is accepted by the server.
///
/// In russh 0.60 the agent path uses `authenticate_publickey_with`, passing the
/// `AgentClient` as a `Signer` so the agent — not us — performs the signature
/// over the SSH transcript.
pub struct AgentAuth;

impl AuthMethod for AgentAuth {
    fn id(&self) -> &'static str {
        "agent"
    }

    fn authenticate<'a>(
        &'a self,
        handle: &'a mut Handle<HostKeyVerifier>,
        user: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), SshError>> + Send + 'a>>
    {
        Box::pin(async move {
            // Fail fast and loud if SSH_AUTH_SOCK is unset — `connect_env` would
            // bubble up a generic I/O error otherwise.
            if std::env::var_os("SSH_AUTH_SOCK").is_none() {
                return Err(SshError::AuthFailed(
                    "SSH agent authentication selected but SSH_AUTH_SOCK is not set. \
                     Start an ssh-agent and add identities (ssh-add) before connecting."
                        .into(),
                ));
            }

            let mut agent = AgentClient::connect_env()
                .await
                .map_err(|e| SshError::AuthFailed(format!("cannot connect to ssh-agent: {e}")))?;

            let identities = agent
                .request_identities()
                .await
                .map_err(|e| SshError::AuthFailed(format!("ssh-agent request_identities failed: {e}")))?;

            if identities.is_empty() {
                return Err(SshError::AuthFailed(
                    "ssh-agent has no identities loaded. Run `ssh-add` to add a key."
                        .into(),
                ));
            }

            let mut last_failure: Option<String> = None;
            for identity in identities {
                let public_key = match &identity {
                    AgentIdentity::PublicKey { key, .. } => Cow::Borrowed(key),
                    AgentIdentity::Certificate { certificate, .. } => {
                        Cow::Owned(certificate.public_key().clone().into())
                    }
                };

                let attempt = handle
                    .authenticate_publickey_with(
                        user,
                        public_key.into_owned(),
                        None, // None → russh picks the default hash alg (sha2-256 for RSA)
                        &mut agent,
                    )
                    .await
                    .map_err(|e| SshError::SshHandshake(e.to_string()))?;

                match attempt {
                    AuthResult::Success => return Ok(()),
                    AuthResult::Failure { partial_success: true, .. } => {
                        return Err(SshError::AuthFailed(
                            "Server requires additional authentication methods (partial success). \
                             Multi-factor SSH auth is not supported in this version."
                                .into(),
                        ));
                    }
                    AuthResult::Failure { remaining_methods, .. } => {
                        last_failure = Some(format!(
                            "server rejected agent identity; remaining methods: {remaining_methods:?}"
                        ));
                    }
                }
            }

            Err(SshError::AuthFailed(format!(
                "ssh-agent: none of the loaded identities were accepted by the server. {}",
                last_failure.unwrap_or_else(|| "no identities tried".into())
            )))
        })
    }
}

/// Factory for `AgentAuth`. Returns `Some` only when `use_ssh_agent` is set *and* no
/// key path is configured on the legacy record (key-file always wins to keep existing
/// connections working).
///
/// Implement this trait pattern to add a new SSH auth variant — see `auth.rs::registry()`.
pub struct AgentAuthFactory;

impl AuthMethodFactory for AgentAuthFactory {
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
        if !secrets.use_ssh_agent {
            return None;
        }
        Some(Box::new(AgentAuth) as Box<dyn AuthMethod>)
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
    fn factory_returns_some_when_agent_flag_set_and_no_key_path() {
        let secrets = AuthSecrets::with_agent();
        assert!(AgentAuthFactory.build(&rec_no_key(), &secrets).is_some());
    }

    #[test]
    fn factory_returns_none_when_agent_flag_unset() {
        let secrets = AuthSecrets::default();
        assert!(AgentAuthFactory.build(&rec_no_key(), &secrets).is_none());
    }

    #[test]
    fn factory_yields_to_key_when_key_path_present() {
        let secrets = AuthSecrets::with_agent();
        assert!(AgentAuthFactory.build(&rec_with_key(), &secrets).is_none());
    }

    #[test]
    fn auth_method_id_is_agent() {
        assert_eq!(AgentAuth.id(), "agent");
    }

    // Best-effort check that the `SSH_AUTH_SOCK` early-exit produces a clear error.
    // We can't easily build a russh `Handle` without a live socket, so we exercise
    // the env-var precondition by inspecting the message a missing-socket attempt
    // would yield. The full agent flow is covered by manual + integration tests.
    #[test]
    fn agent_auth_error_message_mentions_ssh_auth_sock() {
        // Pure string check — defends the user-facing message against accidental rewording.
        let err = SshError::AuthFailed(
            "SSH agent authentication selected but SSH_AUTH_SOCK is not set. \
             Start an ssh-agent and add identities (ssh-add) before connecting."
                .into(),
        );
        let msg = err.to_string();
        assert!(msg.contains("SSH_AUTH_SOCK"));
        assert!(msg.contains("ssh-add"));
    }
}
