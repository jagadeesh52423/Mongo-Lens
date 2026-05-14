use crate::ssh::errors::SshError;
use crate::ssh::known_hosts;
use russh::client::{DisconnectReason, Handler};
use russh::keys::PublicKey;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

/// Shared decision type for host key checks.
/// Set by `check_server_key` before returning false/error so the caller
/// can distinguish "key unknown" from "key mismatch" from generic failures.
#[derive(Debug, Clone)]
pub enum HostKeyDecision {
    Unknown {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    Changed {
        host: String,
        stored_source: &'static str,
    },
}

/// russh client handler responsible for host key verification and session monitoring.
///
/// Implements the TOFU + known_hosts strategy:
///   1. Check `~/.ssh/known_hosts` (read-only).
///   2. Check `~/.mongomacapp/known_hosts` (app-managed).
///   3. If not found → store `HostKeyDecision::Unknown` and reject (caller prompts user).
///   4. If mismatch → store `HostKeyDecision::Changed` and reject (MITM guard).
pub struct HostKeyVerifier {
    pub host: String,
    pub port: u16,
    /// Allows the tunnel to accept the host key on a re-connect after user confirmation.
    pub accept_unknown: bool,
    /// Output slot: set when check_server_key encounters unknown/changed key.
    pub decision: Arc<Mutex<Option<HostKeyDecision>>>,
    /// Watch sender — flipped to `false` when the SSH session disconnects.
    /// The corresponding `Receiver` is held by `TunnelHandle::alive_watch()` consumers.
    pub alive_tx: Arc<watch::Sender<bool>>,
}

#[derive(Debug)]
pub struct HandlerError(pub String);

impl std::fmt::Display for HandlerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for HandlerError {}
impl From<russh::Error> for HandlerError {
    fn from(e: russh::Error) -> Self {
        HandlerError(e.to_string())
    }
}

impl Handler for HostKeyVerifier {
    type Error = HandlerError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // Compute algorithm string and SHA-256 fingerprint for display/logging.
        let algorithm = server_public_key.algorithm().to_string();
        let fingerprint = server_public_key.fingerprint(Default::default()).to_string();

        if self.accept_unknown {
            // The user confirmed the fingerprint shown in the previous round-trip.
            // Re-check the store before writing: if the key changed between the dialog
            // open and the user clicking "Trust", refuse (C2 — prevents TOFU bypass).
            match known_hosts::check_host_key(&self.host, self.port, server_public_key) {
                Ok(true) => {
                    // Already trusted (e.g., another window persisted it) — accept.
                    return Ok(true);
                }
                Err(SshError::HostKeyChanged { host, stored_source }) => {
                    // Key changed between dialog open and accept — refuse.
                    *self.decision.lock().unwrap() = Some(HostKeyDecision::Changed {
                        host,
                        stored_source,
                    });
                    return Ok(false);
                }
                Ok(false) | Err(_) => {
                    // Still unknown (or any other error) — safe to persist.
                    known_hosts::learn_host_key(&self.host, self.port, server_public_key)
                        .map_err(|e| HandlerError(e.to_string()))?;
                    return Ok(true);
                }
            }
        }

        match known_hosts::check_host_key(&self.host, self.port, server_public_key) {
            Ok(true) => Ok(true),
            Ok(false) => {
                // Key is unknown — surface to caller; reject so russh doesn't proceed.
                *self.decision.lock().unwrap() = Some(HostKeyDecision::Unknown {
                    host: self.host.clone(),
                    port: self.port,
                    algorithm,
                    fingerprint,
                });
                Ok(false)
            }
            Err(SshError::HostKeyChanged { host, stored_source }) => {
                *self.decision.lock().unwrap() = Some(HostKeyDecision::Changed {
                    host,
                    stored_source,
                });
                Ok(false)
            }
            Err(e) => Err(HandlerError(e.to_string())),
        }
    }

    /// Called when the server sends a disconnect message or the connection drops.
    /// Flips the watch channel to `false` so the listener loop and any monitor tasks wake up.
    async fn disconnected(
        &mut self,
        _reason: DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        // send() fails only if all Receivers are dropped — safe to ignore.
        let _ = self.alive_tx.send(false);
        Ok(())
    }

    // All other Handler methods use default (no-op) implementations.
}
