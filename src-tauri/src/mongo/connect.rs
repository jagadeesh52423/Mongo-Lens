use crate::db::connections::ConnectionRecord;
use crate::logctx;
use crate::logger::Logger;
use crate::mongo;
use crate::ssh;
use crate::ssh::auth::AuthSecrets;
use crate::ssh::uri::{extract_hosts, rewrite_uri, HostPort};
use mongodb::Client;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

/// Outcome of a `connect` call. The command layer maps each variant to an appropriate
/// frontend response (structured JSON rather than a plain error string for prompts).
pub enum ConnectOutcome {
    /// MongoDB client established and ready.
    Connected {
        client: Client,
        /// The URI variant (with any fallback query params) that the driver connected with.
        winning_uri: String,
        /// Active SSH tunnel handle, if tunneling was used.
        tunnel: Option<ssh::TunnelHandle>,
    },
    /// SSH key is encrypted; user must supply the passphrase and retry.
    PassphraseRequired { connection_id: String },
    /// SSH host key is not in known_hosts; user must confirm the fingerprint and retry.
    HostKeyUnknown {
        connection_id: String,
        fingerprint: String,
        algorithm: String,
        host: String,
        port: u16,
    },
}

/// Main connection entrypoint. Wraps tunnel setup (if SSH fields are configured) and the
/// existing `connect_with_fallback` into a single call.
///
/// Arguments:
/// - `rec`: connection record (SSH fields determine whether tunneling is needed).
/// - `password`: MongoDB password for URI construction.
/// - `passphrase`: SSH key passphrase (supplied on retry after `PassphraseRequired`).
/// - `accept_host_key`: `true` on retry after user confirmed `HostKeyUnknown`.
/// - `log`: logger handle.
pub async fn connect(
    rec: &ConnectionRecord,
    password: Option<&str>,
    secrets: AuthSecrets,
    accept_host_key: bool,
    log: Arc<dyn Logger>,
) -> Result<ConnectOutcome, String> {
    match ssh::SshConfig::from_record(rec, &secrets) {
        Err(ssh::SshError::PassphraseRequired) => {
            return Ok(ConnectOutcome::PassphraseRequired {
                connection_id: rec.id.clone(),
            });
        }
        Err(ssh::SshError::PassphraseIncorrect) => {
            return Err("The passphrase is incorrect. Please try again.".into());
        }
        Err(e) => return Err(e.to_string()),
        Ok(None) => {
            // No SSH config — direct connection.
            let uri = mongo::build_uri(rec, password);
            log.info("mongo connect (no tunnel)", logctx! { "connId" => rec.id.clone() });
            let (client, winning_uri) = mongo::client_for(&uri, log.as_ref())
                .await
                .map_err(|e| e.to_string())?;
            return Ok(ConnectOutcome::Connected {
                client,
                winning_uri,
                tunnel: None,
            });
        }
        Ok(Some(ssh_cfg)) => {
            // SSH config present — validate URI before opening any tunnel.
            let base_uri = mongo::build_uri(rec, password);

            // Reject SRV and multi-seed before spending time on the SSH handshake.
            let hosts = extract_hosts(&base_uri).map_err(|e| e.to_string())?;

            // Open the SSH tunnel.
            log.info(
                "ssh tunnel opening",
                logctx! {
                    "connId"   => rec.id.clone(),
                    "sshHost"  => ssh_cfg.ssh_host.clone(),
                    "sshPort"  => ssh_cfg.ssh_port,
                    "target"   => format!("{}:{}", ssh_cfg.target_host, ssh_cfg.target_port),
                },
            );

            let tunnel_result =
                ssh::open_tunnel(ssh_cfg, accept_host_key, log.clone())
                    .await
                    .map_err(|e| e.to_string())?;

            let tunnel_handle = match tunnel_result {
                ssh::TunnelStartResult::HostKeyUnknown {
                    host,
                    port,
                    algorithm,
                    fingerprint,
                } => {
                    return Ok(ConnectOutcome::HostKeyUnknown {
                        connection_id: rec.id.clone(),
                        fingerprint,
                        algorithm,
                        host,
                        port,
                    });
                }
                ssh::TunnelStartResult::HostKeyChanged { host, stored_source } => {
                    return Err(format!(
                        "The SSH host key for {host} does not match the entry in {stored_source}. \
                         Connection refused to protect against possible MITM attack."
                    ));
                }
                ssh::TunnelStartResult::Ready(h) => h,
            };

            // Build the host → local port mapping.
            let mut mapping: HashMap<HostPort, SocketAddr> = HashMap::new();
            for hp in hosts {
                mapping.insert(hp, tunnel_handle.local_addr);
            }

            // Rewrite the MongoDB URI to point at the local tunnel endpoint.
            let tunneled_uri = rewrite_uri(&base_uri, &mapping).map_err(|e| e.to_string())?;

            log.info(
                "ssh tunnel ready, connecting mongo",
                logctx! {
                    "connId"     => rec.id.clone(),
                    "localAddr"  => tunnel_handle.local_addr.to_string(),
                },
            );

            // Connect MongoDB through the tunnel; close tunnel on failure (no leaks).
            match mongo::client_for(&tunneled_uri, log.as_ref()).await {
                Ok((client, winning_uri)) => Ok(ConnectOutcome::Connected {
                    client,
                    winning_uri,
                    tunnel: Some(tunnel_handle),
                }),
                Err(e) => {
                    tunnel_handle.close().await;
                    Err(format!("MongoDB connection through SSH tunnel failed: {e}"))
                }
            }
        }
    }
}
