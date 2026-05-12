use mongodb::error::Error as MongoError;
use mongodb::options::ClientOptions;

/// Implement this trait and register in `registry()` to add a new connect-time fallback.
/// Strategies must be idempotent — `apply` is only called once per strategy per connect attempt.
pub trait ConnectFallback: Send + Sync {
    /// Stable identifier for logging + de-duplication ("direct-read-pref", "tls").
    fn id(&self) -> &'static str;

    /// Returns true when this strategy should be tried for the given error.
    fn matches(&self, err: &MongoError) -> bool;

    /// Mutates `opts` to apply the fallback. Must not panic.
    fn apply(&self, opts: &mut ClientOptions);
}

pub fn registry() -> &'static [&'static dyn ConnectFallback] {
    // Order matters: try cheaper / more common fallbacks first.
    static REG: &[&dyn ConnectFallback] = &[
        &crate::mongo::strategies::DirectReadPrefFallback,
    ];
    REG
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeStrat;
    impl ConnectFallback for FakeStrat {
        fn id(&self) -> &'static str { "fake" }
        fn matches(&self, _err: &MongoError) -> bool { true }
        fn apply(&self, opts: &mut ClientOptions) {
            opts.app_name = Some("touched".into());
        }
    }

    #[test]
    fn registry_returns_slice() {
        let _ = registry().len();
    }

    #[test]
    fn strategy_can_mutate_options() {
        let mut opts = ClientOptions::default();
        FakeStrat.apply(&mut opts);
        assert_eq!(opts.app_name.as_deref(), Some("touched"));
    }
}
