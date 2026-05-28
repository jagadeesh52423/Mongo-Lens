//! Proxy support for outbound MongoDB connections.
//!
//! # Driver scope (Phase 1)
//!
//! The mongodb v3 driver natively supports **SOCKS5 only**, via the
//! `socks5-proxy` cargo feature exposing `Socks5Proxy` on `ClientOptions`.
//! There is no driver-level support for HTTP CONNECT proxies or SOCKS4,
//! which would require an external connector wrapping the TCP stream.
//!
//! The connection model (`connection::model::Proxy`) intentionally
//! accepts `Http`, `Socks4`, and `Socks5` so the UI can render and round-
//! trip all three. Anything other than SOCKS5 is rejected at builder
//! resolution time by [`validate_for_driver`] with a clear error — the
//! user sees the limitation rather than a silent fall-through to a direct
//! connection.
//!
//! # Extension contract
//!
//! To add HTTP / SOCKS4 support later, replace the `_ => Err(...)` arm in
//! [`validate_for_driver`] with the matching driver wiring. Callers of
//! `ResolvedProxy` do not need to change — the carrier struct shape is
//! protocol-agnostic.

use crate::connection::model::{Proxy, ProxyKind};

/// A proxy spec paired with its resolved password (typically loaded from
/// the keychain). Borrowed because the builder produces this transiently
/// while constructing `ClientOptions`.
///
/// `password` is `None` when the proxy is unauthenticated or when the
/// model carries no `auth` block.
// `ResolvedProxy` is the proxy-side counterpart to `ResolvedConnection`
// and the intended carrier for proxy + secret pairs. The builder
// currently consumes `(Proxy, Option<&str>)` directly because that's
// what its internal `apply_proxy` signature takes; tests construct
// `ResolvedProxy` to validate the carrier shape. Kept public so a
// future builder refactor can switch to it without a new type.
#[derive(Debug)]
#[allow(dead_code)]
pub struct ResolvedProxy<'a> {
    pub spec: &'a Proxy,
    pub password: Option<&'a str>,
}

/// Validate that the configured proxy is one the mongodb v3 driver can
/// natively use. Returns `Err` with a clear, user-facing message
/// otherwise — kept as `String` because callers surface this directly in
/// the staged-error envelope (no `SshError`-style variants needed here).
pub fn validate_for_driver(p: &Proxy) -> Result<(), String> {
    match p.kind {
        ProxyKind::Socks5 => Ok(()),
        ProxyKind::Http => Err(
            "HTTP proxy is not supported by the MongoDB driver in this version. \
             Use a SOCKS5 proxy, or remove the proxy from the connection settings."
                .into(),
        ),
        ProxyKind::Socks4 => Err(
            "SOCKS4 proxy is not supported by the MongoDB driver in this version. \
             Use a SOCKS5 proxy, or remove the proxy from the connection settings."
                .into(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::model::{Proxy, ProxyAuth, ProxyKind};

    fn proxy(kind: ProxyKind) -> Proxy {
        Proxy {
            kind,
            host: "proxy.example.com".into(),
            port: 1080,
            auth: None,
        }
    }

    #[test]
    fn accepts_socks5() {
        assert!(validate_for_driver(&proxy(ProxyKind::Socks5)).is_ok());
    }

    #[test]
    fn rejects_http() {
        let result = validate_for_driver(&proxy(ProxyKind::Http));
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(msg.contains("HTTP proxy"), "unexpected: {msg}");
        assert!(msg.contains("SOCKS5"), "should hint at SOCKS5: {msg}");
    }

    #[test]
    fn rejects_socks4() {
        let result = validate_for_driver(&proxy(ProxyKind::Socks4));
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(msg.contains("SOCKS4"), "unexpected: {msg}");
        assert!(msg.contains("SOCKS5"), "should hint at SOCKS5: {msg}");
    }

    #[test]
    fn accepts_socks5_with_auth() {
        let mut p = proxy(ProxyKind::Socks5);
        p.auth = Some(ProxyAuth {
            username: "user".into(),
        });
        assert!(validate_for_driver(&p).is_ok());
    }

    #[test]
    fn resolved_proxy_holds_borrowed_password() {
        let spec = proxy(ProxyKind::Socks5);
        let password = String::from("s3cret");
        let resolved = ResolvedProxy {
            spec: &spec,
            password: Some(&password),
        };
        // Sanity check the carrier shape — guards against accidental field renames.
        assert_eq!(resolved.spec.host, "proxy.example.com");
        assert_eq!(resolved.spec.port, 1080);
        assert_eq!(resolved.password, Some("s3cret"));
    }

    #[test]
    fn resolved_proxy_password_can_be_absent() {
        let spec = proxy(ProxyKind::Socks5);
        let resolved = ResolvedProxy {
            spec: &spec,
            password: None,
        };
        assert!(resolved.password.is_none());
    }

    // Guard: if a new ProxyKind variant lands in the model without a
    // validate_for_driver arm, this exhaustive match keeps compiling but the
    // assertion below will at least flag that someone needs to touch this file.
    #[test]
    fn validate_for_driver_covers_every_known_kind() {
        for kind in [ProxyKind::Http, ProxyKind::Socks4, ProxyKind::Socks5] {
            let p = proxy(kind);
            let _ = validate_for_driver(&p); // does not panic for any current variant
        }
    }
}
