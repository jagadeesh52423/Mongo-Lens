use crate::db::connections::ConnectionRecord;
use crate::ssh::auth::{AuthMethod, AuthMethodFactory, AuthSecrets};
use crate::ssh::errors::SshError;
use crate::ssh::host_key::HostKeyVerifier;
use russh::client::AuthResult;
use russh::client::Handle;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh::keys::{load_secret_key, PrivateKey};
use std::path::PathBuf;
use std::sync::Arc;
use zeroize::Zeroizing;

/// SSH key file authentication.
/// Loads the private key from `ssh_key_path` (with optional passphrase) and
/// performs `publickey` authentication using `authenticate_publickey`.
pub struct KeyFileAuth {
    key_path: PathBuf,
    /// Passphrase wrapped in `Zeroizing` so its heap memory is wiped on drop (S2).
    passphrase: Option<Zeroizing<String>>,
}

impl AuthMethod for KeyFileAuth {
    fn id(&self) -> &'static str {
        "key"
    }

    fn authenticate<'a>(
        &'a self,
        handle: &'a mut Handle<HostKeyVerifier>,
        user: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), SshError>> + Send + 'a>>
    {
        Box::pin(async move {
            let private_key = self.load_key()?;
            // For Ed25519/ECDSA, hash_alg is ignored; for RSA, None maps to sha2-256 (russh default).
            let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(private_key), None);
            let result = handle
                .authenticate_publickey(user, key_with_alg)
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
                    "Server rejected the SSH key. Ensure the key is authorized on the server."
                        .into(),
                )),
            }
        })
    }
}

impl KeyFileAuth {
    fn load_key(&self) -> Result<PrivateKey, SshError> {
        if !self.key_path.exists() {
            return Err(SshError::KeyFileNotFound(self.key_path.clone()));
        }

        // Reject world-/group-readable keys — ssh(1) does the same.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&self.key_path)
                .map_err(SshError::KeyFileUnreadable)?
                .permissions()
                .mode();
            if mode & 0o077 != 0 {
                return Err(SshError::KeyFilePermissionsTooOpen {
                    path: self.key_path.clone(),
                    mode,
                });
            }
        }

        // `Zeroizing<String>` derefs to `String`; `.as_str()` unwraps to `&str`.
        match load_secret_key(&self.key_path, self.passphrase.as_ref().map(|z| z.as_str())) {
            Ok(key) => Ok(key),
            Err(e) => {
                let msg = e.to_string().to_ascii_lowercase();
                // russh returns an error mentioning "encrypted" or "passphrase" when the key
                // is protected and no passphrase was given.
                if self.passphrase.is_none()
                    && (msg.contains("encrypt") || msg.contains("passphrase") || msg.contains("password"))
                {
                    return Err(SshError::PassphraseRequired);
                }
                if self.passphrase.is_some()
                    && (msg.contains("encrypt") || msg.contains("passphrase") || msg.contains("password")
                        || msg.contains("incorrect") || msg.contains("invalid") || msg.contains("bad"))
                {
                    return Err(SshError::PassphraseIncorrect);
                }
                Err(SshError::KeyFileUnreadable(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    e.to_string(),
                )))
            }
        }
    }
}

/// Factory for `KeyFileAuth`. Returns `Some` when `ssh_key_path` is set on the record.
pub struct KeyFileAuthFactory;

impl AuthMethodFactory for KeyFileAuthFactory {
    fn build(
        &self,
        rec: &ConnectionRecord,
        secrets: &AuthSecrets,
    ) -> Option<Box<dyn AuthMethod>> {
        rec.ssh_key_path.as_ref().filter(|p| !p.is_empty()).map(|p| {
            Box::new(KeyFileAuth {
                key_path: PathBuf::from(p),
                passphrase: secrets.passphrase.clone(),
            }) as Box<dyn AuthMethod>
        })
    }
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
    fn factory_returns_some_when_key_path_set() {
        assert!(KeyFileAuthFactory.build(&rec_with_key("/tmp/id_ed25519"), &AuthSecrets::new(None)).is_some());
    }

    #[test]
    fn factory_returns_none_when_no_key_path() {
        assert!(KeyFileAuthFactory.build(&rec_no_key(), &AuthSecrets::new(None)).is_none());
    }

    #[test]
    fn factory_returns_none_when_empty_key_path() {
        assert!(KeyFileAuthFactory.build(&rec_with_key(""), &AuthSecrets::new(None)).is_none());
    }

    #[test]
    fn load_key_returns_not_found_for_missing_path() {
        let auth = KeyFileAuth {
            key_path: PathBuf::from("/nonexistent/path/id_ed25519"),
            passphrase: None,
        };
        assert!(matches!(auth.load_key(), Err(SshError::KeyFileNotFound(_))));
    }
}
