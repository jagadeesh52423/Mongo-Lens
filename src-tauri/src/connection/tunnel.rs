//! Bridges the new tagged-union `connection::model::SshTunnel` to the
//! model-agnostic `ssh::` layer.
//!
//! This lives in `connection/` (not `ssh/`) on purpose — `ssh/` knows nothing
//! about the connection model, so model changes never ripple into the SSH
//! transport. The bridge dispatches on `SshAuth` to pick the right
//! `AuthMethod`, then builds an `SshConfig` and hands it to
//! `ssh::open_tunnel`.
//!
//! Extension contract: to wire a new `SshAuth` variant, add a match arm
//! below + a constructor on the relevant `ssh::auth_*` module. No other
//! changes are needed.

use std::path::PathBuf;
use std::sync::Arc;

use crate::connection::model::{KnownHostsPolicy, SshAuth, SshTunnel};
use crate::logger::Logger;
use crate::ssh::auth::AuthMethod;
use crate::ssh::auth_agent::AgentAuth;
use crate::ssh::auth_key::KeyFileAuth;
use crate::ssh::auth_password::PasswordAuth;
use crate::ssh::{open_tunnel, SshConfig, SshError, TunnelStartResult};

/// Secrets resolved by the caller (typically from the keychain) and handed to
/// the bridge. `password` is the SSH login password (for `SshAuth::Password`);
/// `key_passphrase` is the private-key passphrase (for
/// `SshAuth::Key { has_passphrase: true, .. }`). Both are plain `String` here
/// because the bridge immediately wraps them in `Zeroizing` inside the auth
/// constructors.
#[derive(Debug, Default)]
pub struct ResolvedSshSecrets {
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
}

/// Dispatch `SshAuth` → `Box<dyn AuthMethod>`.
///
/// Returns an error string (not `SshError`) because missing-secret is a
/// caller programming error, not a transport failure — the caller resolves
/// secrets *before* invoking the bridge.
fn resolve_auth(
    auth: &SshAuth,
    secrets: ResolvedSshSecrets,
) -> Result<Box<dyn AuthMethod>, String> {
    match auth {
        SshAuth::Password => {
            let password = secrets
                .password
                .ok_or_else(|| "SSH password missing for password auth".to_string())?;
            Ok(Box::new(PasswordAuth::new(password)))
        }
        SshAuth::Key {
            key_path,
            has_passphrase,
        } => {
            let passphrase = if *has_passphrase {
                Some(secrets.key_passphrase.ok_or_else(|| {
                    "SSH key passphrase missing for encrypted key".to_string()
                })?)
            } else {
                None
            };
            Ok(Box::new(KeyFileAuth::new(PathBuf::from(key_path), passphrase)))
        }
        SshAuth::Agent => Ok(Box::new(AgentAuth)),
    }
}

/// Translate the known-hosts policy from the new model to the existing
/// `open_tunnel` `accept_unknown_host_key` flag.
///
/// - `Strict` / `AddAndTrust` → respect the caller's `caller_confirmed` flag
///   (typically `false` on first call so the host-key prompt round-trips to
///   the user, then `true` on retry after they confirm).
/// - `AcceptAny` → always accept (test/dev escape hatch; matches existing
///   ssh-keygen `-o StrictHostKeyChecking=no` semantics).
///
/// Persisting the key after `AddAndTrust` confirmation is handled by the
/// host-key verifier itself — out of scope here.
fn policy_to_accept_unknown(policy: KnownHostsPolicy, caller_confirmed: bool) -> bool {
    match policy {
        KnownHostsPolicy::AcceptAny => true,
        KnownHostsPolicy::Strict | KnownHostsPolicy::AddAndTrust => caller_confirmed,
    }
}

/// Open an SSH tunnel for the given new-model `SshTunnel`.
///
/// `caller_confirmed` should be `false` on the first call; on retry after the
/// user confirms a `HostKeyUnknown` result, the caller passes `true` to allow
/// the host-key verifier to persist the key.
pub async fn open(
    tunnel: &SshTunnel,
    secrets: ResolvedSshSecrets,
    target_host: &str,
    target_port: u16,
    caller_confirmed: bool,
    log: Arc<dyn Logger>,
) -> Result<TunnelStartResult, SshError> {
    let auth = resolve_auth(&tunnel.auth, secrets).map_err(SshError::AuthFailed)?;

    let cfg = SshConfig {
        ssh_host: tunnel.host.clone(),
        ssh_port: tunnel.port,
        ssh_user: tunnel.user.clone(),
        auth,
        target_host: target_host.to_string(),
        target_port,
    };

    let accept_unknown = policy_to_accept_unknown(tunnel.known_hosts_policy, caller_confirmed);

    open_tunnel(cfg, accept_unknown, log).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::model::{KnownHostsPolicy, SshAuth, SshTunnel};

    fn tunnel_with(auth: SshAuth) -> SshTunnel {
        SshTunnel {
            host: "bastion.example.com".into(),
            port: 22,
            user: "ubuntu".into(),
            auth,
            known_hosts_policy: KnownHostsPolicy::Strict,
        }
    }

    #[test]
    fn resolve_auth_dispatches_password() {
        let auth = resolve_auth(
            &SshAuth::Password,
            ResolvedSshSecrets {
                password: Some("pw".into()),
                key_passphrase: None,
            },
        )
        .unwrap();
        assert_eq!(auth.id(), "password");
    }

    #[test]
    fn resolve_auth_password_missing_secret_errors() {
        let result = resolve_auth(&SshAuth::Password, ResolvedSshSecrets::default());
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("password missing"));
    }

    #[test]
    fn resolve_auth_dispatches_key_with_passphrase() {
        let auth = resolve_auth(
            &SshAuth::Key {
                key_path: "/tmp/id_ed25519".into(),
                has_passphrase: true,
            },
            ResolvedSshSecrets {
                password: None,
                key_passphrase: Some("pp".into()),
            },
        )
        .unwrap();
        assert_eq!(auth.id(), "key");
    }

    #[test]
    fn resolve_auth_dispatches_key_without_passphrase() {
        let auth = resolve_auth(
            &SshAuth::Key {
                key_path: "/tmp/id_ed25519".into(),
                has_passphrase: false,
            },
            ResolvedSshSecrets::default(),
        )
        .unwrap();
        assert_eq!(auth.id(), "key");
    }

    #[test]
    fn resolve_auth_key_missing_passphrase_errors_when_encrypted() {
        let result = resolve_auth(
            &SshAuth::Key {
                key_path: "/tmp/id_ed25519".into(),
                has_passphrase: true,
            },
            ResolvedSshSecrets::default(),
        );
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("passphrase missing"));
    }

    #[test]
    fn resolve_auth_dispatches_agent() {
        let auth = resolve_auth(&SshAuth::Agent, ResolvedSshSecrets::default()).unwrap();
        assert_eq!(auth.id(), "agent");
    }

    #[test]
    fn policy_strict_first_call_does_not_accept_unknown() {
        assert!(!policy_to_accept_unknown(KnownHostsPolicy::Strict, false));
    }

    #[test]
    fn policy_strict_after_user_confirms_accepts() {
        assert!(policy_to_accept_unknown(KnownHostsPolicy::Strict, true));
    }

    #[test]
    fn policy_add_and_trust_first_call_does_not_accept() {
        assert!(!policy_to_accept_unknown(
            KnownHostsPolicy::AddAndTrust,
            false
        ));
    }

    #[test]
    fn policy_accept_any_always_accepts() {
        assert!(policy_to_accept_unknown(KnownHostsPolicy::AcceptAny, false));
        assert!(policy_to_accept_unknown(KnownHostsPolicy::AcceptAny, true));
    }

    // Round-trip the SshTunnel struct through resolve_auth to catch any future
    // breakage where a new SshAuth variant lands without a corresponding bridge arm.
    #[test]
    fn tunnel_resolves_all_known_auth_variants() {
        for (variant, secrets) in [
            (
                SshAuth::Password,
                ResolvedSshSecrets {
                    password: Some("pw".into()),
                    key_passphrase: None,
                },
            ),
            (
                SshAuth::Key {
                    key_path: "/tmp/id_ed25519".into(),
                    has_passphrase: false,
                },
                ResolvedSshSecrets::default(),
            ),
            (SshAuth::Agent, ResolvedSshSecrets::default()),
        ] {
            let t = tunnel_with(variant);
            let result = resolve_auth(&t.auth, secrets);
            assert!(result.is_ok(), "bridge missing arm for {:?}", t.auth);
        }
    }
}
