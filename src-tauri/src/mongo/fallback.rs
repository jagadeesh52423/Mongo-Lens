use crate::logctx;
use crate::logger::Logger;
use mongodb::error::Error as MongoError;
use mongodb::options::ClientOptions;
use mongodb::Client;

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
        &crate::mongo::strategies::TlsFallback,
    ];
    REG
}

/// Build a client from `uri`, ping `admin`, and on failure walk the registry applying any
/// matching strategies and retrying. Returns the first successful client. Each strategy is
/// applied at most once. If no strategy matches or all retries fail, returns the original error.
pub async fn connect_with_fallback(
    uri: &str,
    log: &dyn Logger,
) -> Result<Client, String> {
    let base_opts = ClientOptions::parse(uri).await.map_err(|e| {
        log.error("mongo parse failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    let mut applied: Vec<&'static str> = Vec::new();
    let mut opts = base_opts;
    let mut last_err: Option<mongodb::error::Error> = None;

    // First attempt + up to `registry().len()` fallback attempts.
    for attempt in 0..=registry().len() {
        let client = match Client::with_options(opts.clone()) {
            Ok(c) => c,
            Err(e) => {
                log.error("mongo client build failed", logctx! { "err" => e.to_string() });
                return Err(e.to_string());
            }
        };

        match client
            .database("admin")
            .run_command(mongodb::bson::doc! {"ping": 1})
            .await
        {
            Ok(_) => {
                if attempt > 0 {
                    log.info("mongo connect ok via fallback", logctx! {
                        "applied" => applied.join(","),
                    });
                }
                return Ok(client);
            }
            Err(e) => {
                log.warn("mongo ping failed", logctx! {
                    "attempt" => attempt as i64,
                    "err" => e.to_string(),
                });
                last_err = Some(e);
            }
        }

        // Find a strategy that matches the latest error and hasn't been applied yet.
        let err = last_err.as_ref().unwrap();
        let next = registry()
            .iter()
            .find(|s| !applied.contains(&s.id()) && s.matches(err));
        match next {
            Some(strat) => {
                log.info("mongo applying fallback", logctx! { "strategy" => strat.id() });
                strat.apply(&mut opts);
                applied.push(strat.id());
            }
            None => break,
        }
    }

    Err(last_err.map(|e| e.to_string()).unwrap_or_else(|| "connect failed".into()))
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
