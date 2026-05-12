use crate::logctx;
use crate::logger::Logger;
use futures_util::future::{select_ok, FutureExt};
use mongodb::options::ClientOptions;
use mongodb::Client;
use std::time::Duration;

/// Implement this trait and register in `registry()` to add a new connect-time fallback.
/// Each strategy contributes URI query params that get appended to the base URI to build
/// a candidate variant; variants are raced in parallel after a short head-start.
pub trait ConnectFallback: Send + Sync {
    /// Stable identifier for logging ("direct-read-pref", "tls").
    fn id(&self) -> &'static str;

    /// URI query parameters to append. Each pair is skipped if its key is already
    /// present in the base URI (case-insensitive), so explicit user choices win.
    fn params(&self) -> &'static [(&'static str, &'static str)];
}

pub fn registry() -> &'static [&'static dyn ConnectFallback] {
    static REG: &[&dyn ConnectFallback] = &[
        &crate::mongo::strategies::DirectReadPrefFallback,
        &crate::mongo::strategies::TlsFallback,
    ];
    REG
}

/// Delay before speculative fallback variants start racing alongside the base attempt.
/// If the base succeeds within this window we never touch the speculative variants.
const HEAD_START: Duration = Duration::from_millis(2000);

fn has_param(uri: &str, key: &str) -> bool {
    let q = match uri.find('?') {
        Some(i) => &uri[i + 1..],
        None => return false,
    };
    q.split('&').any(|kv| {
        let k = kv.split('=').next().unwrap_or("");
        k.eq_ignore_ascii_case(key)
    })
}

fn build_variant_uri(base: &str, params: &[(&'static str, &'static str)]) -> String {
    let additions: Vec<String> = params
        .iter()
        .filter(|(k, _)| !has_param(base, k))
        .map(|(k, v)| format!("{}={}", k, v))
        .collect();
    if additions.is_empty() {
        return base.to_string();
    }
    let sep = if base.contains('?') { '&' } else { '?' };
    format!("{}{}{}", base, sep, additions.join("&"))
}

async fn try_variant(
    uri: String,
    label: &'static str,
    delay: Duration,
) -> Result<(Client, String, &'static str), String> {
    if !delay.is_zero() {
        tokio::time::sleep(delay).await;
    }
    let opts = ClientOptions::parse(&uri).await.map_err(|e| e.to_string())?;
    let client = Client::with_options(opts).map_err(|e| e.to_string())?;
    client
        .database("admin")
        .run_command(mongodb::bson::doc! {"ping": 1})
        .await
        .map_err(|e| e.to_string())?;
    Ok((client, uri, label))
}

/// Connect using `uri` and ping `admin` to validate. The base attempt runs immediately;
/// if it hasn't succeeded within `HEAD_START`, every registered fallback variant is raced
/// in parallel. Returns the winning `(Client, uri_that_worked)` so callers can pass the
/// proven URI to downstream consumers (e.g., the Node query runner).
pub async fn connect_with_fallback(
    uri: &str,
    log: &dyn Logger,
) -> Result<(Client, String), String> {
    let mut variants = vec![try_variant(uri.to_string(), "base", Duration::ZERO).boxed()];

    for strat in registry() {
        let variant_uri = build_variant_uri(uri, strat.params());
        if variant_uri != uri {
            variants.push(try_variant(variant_uri, strat.id(), HEAD_START).boxed());
        }
    }

    if registry().len() > 1 {
        let mut all = uri.to_string();
        for strat in registry() {
            all = build_variant_uri(&all, strat.params());
        }
        if all != uri {
            variants.push(try_variant(all, "all", HEAD_START).boxed());
        }
    }

    match select_ok(variants).await {
        Ok(((client, winning_uri, label), _rest)) => {
            if label != "base" {
                log.info(
                    "mongo connect ok via fallback",
                    logctx! { "applied" => label },
                );
            }
            Ok((client, winning_uri))
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
        fn params(&self) -> &'static [(&'static str, &'static str)] {
            &[("appName", "touched")]
        }
    }

    #[test]
    fn registry_returns_slice() {
        let _ = registry().len();
    }

    #[test]
    fn build_variant_uri_appends_when_no_query() {
        let out = build_variant_uri(
            "mongodb://h:27017/db",
            &[("directConnection", "true"), ("readPreference", "secondaryPreferred")],
        );
        assert_eq!(
            out,
            "mongodb://h:27017/db?directConnection=true&readPreference=secondaryPreferred"
        );
    }

    #[test]
    fn build_variant_uri_appends_when_query_exists() {
        let out = build_variant_uri(
            "mongodb://h/db?authSource=admin",
            &[("directConnection", "true")],
        );
        assert_eq!(out, "mongodb://h/db?authSource=admin&directConnection=true");
    }

    #[test]
    fn build_variant_uri_skips_keys_user_already_set() {
        let out = build_variant_uri(
            "mongodb://h/db?directConnection=false",
            &[("directConnection", "true"), ("readPreference", "primary")],
        );
        assert_eq!(
            out,
            "mongodb://h/db?directConnection=false&readPreference=primary"
        );
    }

    #[test]
    fn build_variant_uri_returns_base_when_all_keys_present() {
        let base = "mongodb://h/db?directConnection=false&readPreference=primary";
        let out = build_variant_uri(
            base,
            &[("directConnection", "true"), ("readPreference", "secondary")],
        );
        assert_eq!(out, base);
    }

    #[test]
    fn has_param_is_case_insensitive() {
        assert!(has_param("mongodb://h/db?TLS=true", "tls"));
        assert!(!has_param("mongodb://h/db?other=1", "tls"));
    }

    #[test]
    fn fake_strategy_params_used() {
        assert_eq!(FakeStrat.id(), "fake");
        assert_eq!(FakeStrat.params(), &[("appName", "touched")]);
    }
}
