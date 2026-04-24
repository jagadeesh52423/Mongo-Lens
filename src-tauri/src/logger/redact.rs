use super::LogCtx;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const SENSITIVE_KEYS: &[&str] = &["password", "secret", "token", "authorization"];
const URI_KEYS: &[&str] = &["uri", "mongoUri", "connectionString"];

fn redact_uri(raw: &str) -> String {
    // mongodb://user:password@host/db → mongodb://user:***@host/db
    // Parse manually — MongoDB URIs include `+srv` variants that url::Url handles fine,
    // but we use a substring approach to keep the dependency footprint small.
    if let Some(scheme_end) = raw.find("://") {
        let (scheme, rest) = raw.split_at(scheme_end + 3);
        if let Some(at) = rest.find('@') {
            let creds = &rest[..at];
            let tail = &rest[at..];
            if let Some(colon) = creds.find(':') {
                let user = &creds[..colon];
                return format!("{scheme}{user}:***{tail}");
            }
        }
        return raw.to_owned();
    }
    "[unparseable-uri]".to_owned()
}

fn redact_script(raw: &str) -> String {
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    let hash = hex::encode(h.finalize());
    let head = if raw.chars().count() > 200 {
        let truncated: String = raw.chars().take(200).collect();
        format!("{truncated}…")
    } else {
        raw.to_owned()
    };
    format!("{head} hash:{hash}")
}

pub fn redact_ctx(ctx: LogCtx) -> LogCtx {
    let mut out = LogCtx::new();
    for (k, v) in ctx {
        if SENSITIVE_KEYS.contains(&k.as_str()) {
            out.insert(k, json!("***"));
        } else if URI_KEYS.contains(&k.as_str()) {
            if let Value::String(s) = &v {
                out.insert(k, json!(redact_uri(s)));
            } else {
                out.insert(k, v);
            }
        } else if k == "script" {
            if let Value::String(s) = &v {
                out.insert(k, json!(redact_script(s)));
            } else {
                out.insert(k, v);
            }
        } else {
            out.insert(k, v);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logctx;

    #[test]
    fn redacts_mongo_uri_password() {
        let r = redact_ctx(logctx! { "uri" => "mongodb://user:secret@host/db" });
        assert_eq!(r.get("uri").unwrap(), &json!("mongodb://user:***@host/db"));
    }

    #[test]
    fn masks_password_and_token_fields() {
        let r = redact_ctx(logctx! { "password" => "p", "token" => "t" });
        assert_eq!(r.get("password").unwrap(), &json!("***"));
        assert_eq!(r.get("token").unwrap(), &json!("***"));
    }

    #[test]
    fn truncates_and_hashes_script() {
        let script: String = "a".repeat(500);
        let r = redact_ctx(logctx! { "script" => script });
        let out = r.get("script").unwrap().as_str().unwrap().to_owned();
        assert!(out.contains("…"));
        assert!(out.contains("hash:"));
    }

    #[test]
    fn passes_through_unrelated_fields() {
        let r = redact_ctx(logctx! { "connId" => "c_1", "page" => 3 });
        assert_eq!(r.get("connId").unwrap(), &json!("c_1"));
        assert_eq!(r.get("page").unwrap(), &json!(3));
    }
}
