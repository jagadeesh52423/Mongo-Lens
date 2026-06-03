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
/// Returns typed [`SshError`] so two paths can be distinguished:
///   * `SshError::PassphraseRequired` — known-encrypted key, no passphrase
///     resolved. The IPC layer translates this to a passphrase prompt
///     (see `builder::open_ssh_if_configured` → `BuildOutcome::PassphraseRequired`).
///   * `SshError::AuthFailed(...)` — caller programming error (e.g. the
///     model says password auth but no password was resolved).
///
/// The previous shape returned a `String` for every missing-secret case,
/// which collapsed both into the same opaque "auth failed" surface and
/// hid the user-prompt opportunity from the v2 dialog flow.
fn resolve_auth(
    auth: &SshAuth,
    secrets: ResolvedSshSecrets,
) -> Result<Box<dyn AuthMethod>, SshError> {
    match auth {
        SshAuth::Password => {
            let password = secrets.password.ok_or_else(|| {
                SshError::AuthFailed("SSH password missing for password auth".into())
            })?;
            Ok(Box::new(PasswordAuth::new(password)))
        }
        SshAuth::Key {
            key_path,
            has_passphrase,
        } => {
            let passphrase = if *has_passphrase {
                Some(
                    secrets
                        .key_passphrase
                        // No passphrase resolved but the model knows the
                        // key is encrypted — that's exactly the prompt
                        // signal, not a hard failure.
                        .ok_or(SshError::PassphraseRequired)?,
                )
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
    // resolve_auth already returns a typed SshError — propagate as-is so
    // PassphraseRequired survives intact (see resolve_auth's contract).
    let auth = resolve_auth(&tunnel.auth, secrets)?;

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
            enabled: true,
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
    fn resolve_auth_password_missing_secret_errors_as_auth_failed() {
        // Missing SSH password for password auth is a caller programming
        // error (the dialog should have rejected save), so AuthFailed is
        // the right shape — distinct from PassphraseRequired which is a
        // user-prompt outcome.
        // `Box<dyn AuthMethod>` is not `Debug`, so we can't use `{:?}` on
        // the `Ok` branch — match on Err first, otherwise the test fails
        // with an explicit message.
        match resolve_auth(&SshAuth::Password, ResolvedSshSecrets::default()) {
            Err(SshError::AuthFailed(msg)) => assert!(msg.contains("password missing"), "msg: {msg}"),
            Err(other) => panic!("expected AuthFailed, got {other:?}"),
            Ok(_) => panic!("expected Err(AuthFailed), got Ok(<auth>)"),
        }
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
    fn resolve_auth_key_missing_passphrase_emits_passphrase_required() {
        // Model says has_passphrase=true but the caller didn't resolve
        // one — this is the prompt signal, not a hard failure. The
        // builder's SSH step folds it into BuildOutcome::PassphraseRequired
        // and the IPC layer maps that to ConnectResultV2::PassphraseRequired.
        match resolve_auth(
            &SshAuth::Key {
                key_path: "/tmp/id_ed25519".into(),
                has_passphrase: true,
            },
            ResolvedSshSecrets::default(),
        ) {
            Err(SshError::PassphraseRequired) => {} // expected
            Err(other) => panic!("expected PassphraseRequired, got {other:?}"),
            Ok(_) => panic!("expected Err(PassphraseRequired), got Ok(<auth>)"),
        }
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
