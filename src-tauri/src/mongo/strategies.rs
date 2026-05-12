use crate::mongo::fallback::ConnectFallback;
use mongodb::options::{ClientOptions, ReadPreference, ReadPreferenceOptions, SelectionCriteria};

/// Recovers from "no primary reachable" errors that occur when:
///   - the user SSH-tunnels to a single replica-set member, OR
///   - the only reachable node is a secondary
/// Adds `directConnection=true` and `readPreference=secondaryPreferred` if absent.
pub struct DirectReadPrefFallback;

impl ConnectFallback for DirectReadPrefFallback {
    fn id(&self) -> &'static str { "direct-read-pref" }

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

    fn apply(&self, opts: &mut ClientOptions) {
        if opts.tls.is_none() {
            opts.tls = Some(mongodb::options::Tls::Enabled(TlsOptions::default()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
