use crate::logctx;
use crate::logger::Logger;
use futures_util::future::{select_ok, FutureExt};
use mongodb::options::ClientOptions;
use mongodb::Client;
use std::time::Duration;

/// Implement this trait and register in `registry()` to add a new connect-time fallback.
/// Variants are raced in parallel after a short head-start; `apply` is invoked once per
/// connect call to build the variant's options.
pub trait ConnectFallback: Send + Sync {
    /// Stable identifier for logging ("direct-read-pref", "tls").
    fn id(&self) -> &'static str;

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

/// Delay before speculative fallback variants start racing alongside the base attempt.
/// If the base succeeds within this window we never touch the speculative variants.
const HEAD_START: Duration = Duration::from_millis(2000);

async fn try_variant(
    opts: ClientOptions,
    label: &'static str,
    delay: Duration,
) -> Result<(Client, &'static str), String> {
    if !delay.is_zero() {
        tokio::time::sleep(delay).await;
    }
    let client = Client::with_options(opts).map_err(|e| e.to_string())?;
    client
        .database("admin")
        .run_command(mongodb::bson::doc! {"ping": 1})
        .await
        .map_err(|e| e.to_string())?;
    Ok((client, label))
}

/// Build a client from `uri` and ping `admin` to validate. The base attempt runs immediately;
/// if it hasn't succeeded within `HEAD_START`, every registered fallback strategy is applied
/// to a separate option set and raced in parallel. The first variant to ping successfully wins;
/// the rest are dropped. If all variants fail, the last error is returned.
pub async fn connect_with_fallback(uri: &str, log: &dyn Logger) -> Result<Client, String> {
    let base_opts = ClientOptions::parse(uri).await.map_err(|e| {
        log.error("mongo parse failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    let mut variants = vec![try_variant(base_opts.clone(), "base", Duration::ZERO).boxed()];

    // Individual-strategy variants.
    for strat in registry() {
        let mut opts = base_opts.clone();
        strat.apply(&mut opts);
        variants.push(try_variant(opts, strat.id(), HEAD_START).boxed());
    }

    // All-strategies-stacked variant (cheap insurance for cases that need multiple fallbacks).
    if registry().len() > 1 {
        let mut opts = base_opts.clone();
        for strat in registry() {
            strat.apply(&mut opts);
        }
        variants.push(try_variant(opts, "all", HEAD_START).boxed());
    }

    match select_ok(variants).await {
        Ok(((client, label), _rest)) => {
            if label != "base" {
                log.info(
                    "mongo connect ok via fallback",
                    logctx! { "applied" => label },
                );
            }
            Ok(client)
        }
        Err(e) => {
            log.warn("mongo connect all variants failed", logctx! { "err" => e.clone() });
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeStrat;
    impl ConnectFallback for FakeStrat {
        fn id(&self) -> &'static str { "fake" }
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
