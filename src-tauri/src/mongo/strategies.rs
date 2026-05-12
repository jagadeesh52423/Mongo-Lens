use crate::mongo::fallback::ConnectFallback;
use mongodb::error::Error as MongoError;
use mongodb::options::{ClientOptions, ReadPreference, ReadPreferenceOptions, SelectionCriteria};

/// Recovers from "no primary reachable" errors that occur when:
///   - the user SSH-tunnels to a single replica-set member, OR
///   - the only reachable node is a secondary
/// Adds `directConnection=true` and `readPreference=secondaryPreferred` if absent.
pub struct DirectReadPrefFallback;

impl ConnectFallback for DirectReadPrefFallback {
    fn id(&self) -> &'static str { "direct-read-pref" }

    fn matches(&self, err: &MongoError) -> bool {
        let msg = err.to_string().to_lowercase();
        // Server returns code 10107 (NotWritablePrimary) or topology errors mentioning primary.
        msg.contains("not primary")
            || msg.contains("notwritableprimary")
            || msg.contains("no primary")
            || msg.contains("server selection")
    }

    fn apply(&self, opts: &mut ClientOptions) {
        if opts.direct_connection.is_none() {
            opts.direct_connection = Some(true);
        }
        if opts.selection_criteria.is_none() {
            opts.selection_criteria = Some(SelectionCriteria::ReadPreference(
                ReadPreference::SecondaryPreferred {
                    options: Some(ReadPreferenceOptions::default()),
                },
            ));
        }
    }
}

use mongodb::options::TlsOptions;

/// Recovers from TLS-handshake / "connection closed" errors when connecting to
/// managed clusters (Atlas, DocumentDB) that require TLS by default.
pub struct TlsFallback;

impl ConnectFallback for TlsFallback {
    fn id(&self) -> &'static str { "tls" }

    fn matches(&self, err: &MongoError) -> bool {
        let msg = err.to_string().to_lowercase();
        msg.contains("tls")
            || msg.contains("ssl")
            || msg.contains("connection closed")
            || msg.contains("handshake")
    }

    fn apply(&self, opts: &mut ClientOptions) {
        if opts.tls.is_none() {
            opts.tls = Some(mongodb::options::Tls::Enabled(TlsOptions::default()));
        }
    }
}

#[cfg(test)]
fn make_err(msg: &str) -> MongoError {
    // The mongodb 3.x driver doesn't expose a public `Error::custom` constructor.
    // We construct an Error via the `From<std::io::Error>` impl — the matcher reads
    // `err.to_string()`, so as long as the message content surfaces, the test is valid.
    MongoError::from(std::io::Error::new(std::io::ErrorKind::Other, msg.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_not_primary_error_text() {
        let err = make_err("not primary and secondaryOk=false");
        assert!(DirectReadPrefFallback.matches(&err));
    }

    #[test]
    fn matches_server_selection_error_text() {
        let err = make_err("Server selection timeout: no available servers");
        assert!(DirectReadPrefFallback.matches(&err));
    }

    #[test]
    fn does_not_match_unrelated_error() {
        let err = make_err("authentication failed: bad password");
        assert!(!DirectReadPrefFallback.matches(&err));
    }

    #[test]
    fn apply_sets_direct_and_read_pref_when_absent() {
        let mut opts = ClientOptions::default();
        DirectReadPrefFallback.apply(&mut opts);
        assert_eq!(opts.direct_connection, Some(true));
        assert!(matches!(
            opts.selection_criteria,
            Some(SelectionCriteria::ReadPreference(ReadPreference::SecondaryPreferred { .. }))
        ));
    }

    #[test]
    fn apply_preserves_user_supplied_direct_connection() {
        let mut opts = ClientOptions::default();
        opts.direct_connection = Some(false);
        DirectReadPrefFallback.apply(&mut opts);
        assert_eq!(opts.direct_connection, Some(false));
    }

    #[test]
    fn apply_preserves_user_supplied_read_pref() {
        let mut opts = ClientOptions::default();
        opts.selection_criteria = Some(SelectionCriteria::ReadPreference(ReadPreference::Primary));
        DirectReadPrefFallback.apply(&mut opts);
        assert!(matches!(
            opts.selection_criteria,
            Some(SelectionCriteria::ReadPreference(ReadPreference::Primary))
        ));
    }
}

#[cfg(test)]
mod tls_tests {
    use super::*;

    #[test]
    fn matches_tls_error() {
        let err = make_err("TLS handshake failed");
        assert!(TlsFallback.matches(&err));
    }

    #[test]
    fn matches_connection_closed() {
        let err = make_err("connection closed unexpectedly");
        assert!(TlsFallback.matches(&err));
    }

    #[test]
    fn does_not_match_auth_error() {
        let err = make_err("authentication failed");
        assert!(!TlsFallback.matches(&err));
    }

    #[test]
    fn apply_enables_tls_when_absent() {
        let mut opts = ClientOptions::default();
        TlsFallback.apply(&mut opts);
        assert!(matches!(opts.tls, Some(mongodb::options::Tls::Enabled(_))));
    }

    #[test]
    fn apply_preserves_user_tls_disabled() {
        let mut opts = ClientOptions::default();
        opts.tls = Some(mongodb::options::Tls::Disabled);
        TlsFallback.apply(&mut opts);
        assert!(matches!(opts.tls, Some(mongodb::options::Tls::Disabled)));
    }
}
