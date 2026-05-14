use crate::db::connections::ConnectionRecord;
use crate::ssh::auth::{build_auth_method, AuthMethod, AuthSecrets};
use crate::ssh::errors::SshError;

/// All parameters needed to open an SSH tunnel.
pub struct SshConfig {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    /// Authentication strategy (resolved from the connection record).
    pub auth: Box<dyn AuthMethod>,
    /// MongoDB host as seen from the SSH server side.
    pub target_host: String,
    /// MongoDB port as seen from the SSH server side.
    pub target_port: u16,
}

impl SshConfig {
    /// Build an `SshConfig` from a connection record.
    ///
    /// Returns `None` if no SSH fields are present (no tunnel needed).
    /// Returns `Err` if SSH fields are partially set or the auth method cannot be resolved.
    pub fn from_record(
        rec: &ConnectionRecord,
        secrets: &AuthSecrets,
    ) -> Result<Option<Self>, SshError> {
        let ssh_host = match &rec.ssh_host {
            Some(h) if !h.is_empty() => h.clone(),
            _ => return Ok(None), // No SSH host — no tunnel
        };

        let ssh_user = rec
            .ssh_user
            .clone()
            .filter(|u| !u.is_empty())
            .ok_or_else(|| {
                SshError::AuthFailed(
                    "SSH tunneling requires an SSH username. \
                     Set the SSH User field in connection settings."
                        .into(),
                )
            })?;

        let ssh_port = rec
            .ssh_port
            .map(|p| {
                u16::try_from(p).map_err(|_| {
                    SshError::UriRewrite(format!("invalid SSH port: {p}"))
                })
            })
            .transpose()?
            .unwrap_or(22);

        // Resolve MongoDB target from the connection record.
        // When SSH is used, the target is the MongoDB host as seen from the SSH server.
        let target_host = rec
            .host
            .clone()
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| "localhost".into());

        let target_port = rec
            .port
            .map(|p| {
                u16::try_from(p).map_err(|_| {
                    SshError::UriRewrite(format!("invalid MongoDB port: {p}"))
                })
            })
            .transpose()?
            .unwrap_or(27017);

        let auth = build_auth_method(rec, secrets)?;

        Ok(Some(SshConfig {
            ssh_host,
            ssh_port,
            ssh_user,
            auth,
            target_host,
            target_port,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_rec() -> ConnectionRecord {
        ConnectionRecord {
            id: "1".into(),
            name: "t".into(),
            host: Some("mongo.internal".into()),
            port: Some(27017),
            auth_db: Some("admin".into()),
            username: Some("admin".into()),
            conn_string: None,
            ssh_host: Some("bastion.example.com".into()),
            ssh_port: Some(22),
            ssh_user: Some("ubuntu".into()),
            ssh_key_path: Some("/home/user/.ssh/id_ed25519".into()),
            created_at: "2026-05-14".into(),
        }
    }

    #[test]
    fn returns_none_when_no_ssh_host() {
        let mut rec = base_rec();
        rec.ssh_host = None;
        let result = SshConfig::from_record(&rec, &AuthSecrets::new(None)).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_ssh_host_empty() {
        let mut rec = base_rec();
        rec.ssh_host = Some("".into());
        let result = SshConfig::from_record(&rec, &AuthSecrets::new(None)).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn err_when_no_ssh_user() {
        let mut rec = base_rec();
        rec.ssh_user = None;
        assert!(SshConfig::from_record(&rec, &AuthSecrets::new(None)).is_err());
    }

    #[test]
    fn err_when_no_auth_method() {
        let mut rec = base_rec();
        rec.ssh_key_path = None;
        assert!(SshConfig::from_record(&rec, &AuthSecrets::new(None)).is_err());
    }

    #[test]
    fn defaults_ssh_port_22() {
        let mut rec = base_rec();
        rec.ssh_port = None;
        let cfg = SshConfig::from_record(&rec, &AuthSecrets::new(None)).unwrap().unwrap();
        assert_eq!(cfg.ssh_port, 22);
    }

    #[test]
    fn defaults_target_port_27017() {
        let mut rec = base_rec();
        rec.port = None;
        let cfg = SshConfig::from_record(&rec, &AuthSecrets::new(None)).unwrap().unwrap();
        assert_eq!(cfg.target_port, 27017);
    }
}
