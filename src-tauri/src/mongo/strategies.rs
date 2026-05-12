use crate::mongo::fallback::ConnectFallback;

/// Recovers from "no primary reachable" errors that occur when:
///   - the user SSH-tunnels to a single replica-set member, OR
///   - the only reachable node is a secondary
/// Adds `directConnection=true` and `readPreference=secondaryPreferred` if absent.
pub struct DirectReadPrefFallback;

impl ConnectFallback for DirectReadPrefFallback {
    fn id(&self) -> &'static str { "direct-read-pref" }

    fn params(&self) -> &'static [(&'static str, &'static str)] {
        &[
            ("directConnection", "true"),
            ("readPreference", "secondaryPreferred"),
        ]
    }
}

/// Recovers from TLS-handshake / "connection closed" errors when connecting to
/// managed clusters (Atlas, DocumentDB) that require TLS by default.
pub struct TlsFallback;

impl ConnectFallback for TlsFallback {
    fn id(&self) -> &'static str { "tls" }

    fn params(&self) -> &'static [(&'static str, &'static str)] {
        &[("tls", "true")]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_read_pref_params() {
        assert_eq!(DirectReadPrefFallback.id(), "direct-read-pref");
        assert_eq!(
            DirectReadPrefFallback.params(),
            &[
                ("directConnection", "true"),
                ("readPreference", "secondaryPreferred"),
            ]
        );
    }

    #[test]
    fn tls_params() {
        assert_eq!(TlsFallback.id(), "tls");
        assert_eq!(TlsFallback.params(), &[("tls", "true")]);
    }
}
