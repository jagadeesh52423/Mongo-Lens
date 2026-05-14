use crate::ssh::errors::SshError;
use std::collections::HashMap;
use std::net::SocketAddr;

/// A parsed host:port pair from a MongoDB URI hostlist.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct HostPort {
    pub host: String,
    pub port: u16,
}

const DEFAULT_MONGO_PORT: u16 = 27017;

/// Parse a single `host`, `host:port`, or `[host]:port` token from a MongoDB host list.
fn parse_host_token(token: &str) -> Result<HostPort, SshError> {
    let token = token.trim();
    if token.starts_with('[') {
        // IPv6 bracketed: [::1]:27017
        let close = token
            .find(']')
            .ok_or_else(|| SshError::UriRewrite(format!("invalid host token: {token}")))?;
        let host = token[1..close].to_string();
        let port = if token.len() > close + 1 && token.as_bytes()[close + 1] == b':' {
            token[close + 2..]
                .parse::<u16>()
                .map_err(|_| SshError::UriRewrite(format!("invalid port in token: {token}")))?
        } else {
            DEFAULT_MONGO_PORT
        };
        Ok(HostPort { host, port })
    } else if let Some(colon) = token.rfind(':') {
        // host:port — only if the colon does not look like IPv6 (no other colons)
        let before = &token[..colon];
        let after = &token[colon + 1..];
        if !before.contains(':') {
            if let Ok(port) = after.parse::<u16>() {
                return Ok(HostPort {
                    host: before.to_string(),
                    port,
                });
            }
        }
        // Treat as plain host (IPv6 without brackets — unusual but fall back)
        Ok(HostPort {
            host: token.to_string(),
            port: DEFAULT_MONGO_PORT,
        })
    } else {
        Ok(HostPort {
            host: token.to_string(),
            port: DEFAULT_MONGO_PORT,
        })
    }
}

/// Extract the host list from a `mongodb://` URI.
/// Returns `(before_hosts, host_tokens, after_hosts)` where:
///   - `before_hosts` = everything up to and including `//` (plus optional userinfo)
///   - `host_tokens`  = the raw host list string (between `//[userinfo@]` and `/`)
///   - `after_hosts`  = everything after the host list (starting with `/`)
fn split_uri(uri: &str) -> Result<(String, String, String), SshError> {
    if !uri.starts_with("mongodb://") {
        return Err(SshError::UriRewrite(format!(
            "expected mongodb:// scheme, got: {uri}"
        )));
    }
    let after_scheme = &uri[10..]; // strip "mongodb://"

    // Find userinfo (ends with @)
    let (userinfo_prefix, hosts_and_rest) = match after_scheme.find('@') {
        Some(at) => {
            // Make sure @ is before the first /
            let slash_pos = after_scheme.find('/').unwrap_or(after_scheme.len());
            if at < slash_pos {
                let userinfo = &after_scheme[..=at]; // includes @
                let rest = &after_scheme[at + 1..];
                (userinfo.to_string(), rest)
            } else {
                ("".to_string(), after_scheme)
            }
        }
        None => ("".to_string(), after_scheme),
    };

    // hosts_and_rest = "host1:port1,host2:port2/db?query" or "host:port/db"
    let (host_list, rest) = match hosts_and_rest.find('/') {
        Some(slash) => (
            hosts_and_rest[..slash].to_string(),
            hosts_and_rest[slash..].to_string(),
        ),
        None => (hosts_and_rest.to_string(), "/".to_string()),
    };

    let before = format!("mongodb://{userinfo_prefix}");
    Ok((before, host_list, rest))
}

/// Rewrite a `mongodb://` URI, replacing each `host:port` in the host list with
/// the corresponding local `SocketAddr` from `mapping`.
///
/// Rules per the approved design (and review feedback):
/// - `mongodb+srv://` → `Err(SshError::SrvNotSupported)`
/// - Multiple seeds  → `Err(SshError::MultiSeedNotSupported)` (I-3 fix)
/// - Single host     → replace with `127.0.0.1:<local_port>`, preserve userinfo/path/query
/// - If `tls=true` (or `ssl=true`) in query → append `tlsServerName=<original_host>` (C-1 fix)
pub fn rewrite_uri(
    base_uri: &str,
    mapping: &HashMap<HostPort, SocketAddr>,
) -> Result<String, SshError> {
    if base_uri.starts_with("mongodb+srv://") {
        return Err(SshError::SrvNotSupported);
    }

    let (before, host_list, after) = split_uri(base_uri)?;

    // Reject multi-seed URIs (per I-3 decision: simpler and honest about the limitation)
    if host_list.contains(',') {
        return Err(SshError::MultiSeedNotSupported);
    }

    let hp = parse_host_token(&host_list)?;
    let local_addr = mapping
        .get(&hp)
        .ok_or_else(|| SshError::UriRewrite(format!("no tunnel mapping for {}:{}", hp.host, hp.port)))?;

    // Detect TLS and check for a pre-existing tlsServerName (§6.4, S3).
    // We only append tlsServerName when (a) tls/ssl is true AND (b) the user hasn't
    // already set tlsServerName — duplicate params have undefined driver behaviour.
    let (tls_active, tls_server_name_already_set) = {
        let query_part = after.find('?').map(|i| &after[i + 1..]).unwrap_or("");
        let mut tls_on = false;
        let mut has_tls_sn = false;
        for kv in query_part.split('&') {
            let mut parts = kv.splitn(2, '=');
            let key = parts.next().unwrap_or("").to_ascii_lowercase();
            let val = parts.next().unwrap_or("").to_ascii_lowercase();
            if (key == "tls" || key == "ssl") && val == "true" {
                tls_on = true;
            }
            if key == "tlsservername" {
                has_tls_sn = true;
            }
        }
        (tls_on, has_tls_sn)
    };
    let needs_tls_server_name = tls_active && !tls_server_name_already_set;

    let rewritten_host = format!("127.0.0.1:{}", local_addr.port());

    // Build output
    let mut out = format!("{before}{rewritten_host}{after}");
    if needs_tls_server_name {
        let sep = if out.contains('?') { '&' } else { '?' };
        out.push(sep);
        out.push_str(&format!("tlsServerName={}", hp.host));
    }

    Ok(out)
}

/// Extract all host:port pairs from a `mongodb://` URI for tunnel setup.
/// Returns `Err` for SRV or multi-seed URIs before any tunnel is opened.
pub fn extract_hosts(uri: &str) -> Result<Vec<HostPort>, SshError> {
    if uri.starts_with("mongodb+srv://") {
        return Err(SshError::SrvNotSupported);
    }
    let (_, host_list, _) = split_uri(uri)?;
    if host_list.contains(',') {
        return Err(SshError::MultiSeedNotSupported);
    }
    Ok(vec![parse_host_token(&host_list)?])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(port: u16) -> SocketAddr {
        format!("127.0.0.1:{port}").parse().unwrap()
    }

    fn mapping(host: &str, port: u16, local_port: u16) -> HashMap<HostPort, SocketAddr> {
        let mut m = HashMap::new();
        m.insert(HostPort { host: host.into(), port }, addr(local_port));
        m
    }

    #[test]
    fn rewrite_single_host_no_auth() {
        let out = rewrite_uri(
            "mongodb://db.internal:27017/mydb",
            &mapping("db.internal", 27017, 55000),
        )
        .unwrap();
        assert_eq!(out, "mongodb://127.0.0.1:55000/mydb");
    }

    #[test]
    fn rewrite_preserves_userinfo_and_query() {
        let out = rewrite_uri(
            "mongodb://user:pw@db.internal:27017/admin?authSource=admin",
            &mapping("db.internal", 27017, 55001),
        )
        .unwrap();
        assert_eq!(
            out,
            "mongodb://user:pw@127.0.0.1:55001/admin?authSource=admin"
        );
    }

    #[test]
    fn rewrite_tls_true_appends_tls_server_name() {
        let out = rewrite_uri(
            "mongodb://user:pw@db.internal:27017/admin?tls=true&authSource=admin",
            &mapping("db.internal", 27017, 55002),
        )
        .unwrap();
        assert_eq!(
            out,
            "mongodb://user:pw@127.0.0.1:55002/admin?tls=true&authSource=admin&tlsServerName=db.internal"
        );
    }

    #[test]
    fn rewrite_ssl_true_appends_tls_server_name() {
        let out = rewrite_uri(
            "mongodb://host:27017/db?ssl=true",
            &mapping("host", 27017, 55003),
        )
        .unwrap();
        assert!(out.contains("tlsServerName=host"));
    }

    #[test]
    fn rewrite_tls_false_does_not_append() {
        let out = rewrite_uri(
            "mongodb://host:27017/db?tls=false",
            &mapping("host", 27017, 55004),
        )
        .unwrap();
        assert!(!out.contains("tlsServerName"));
    }

    #[test]
    fn rewrite_no_query_no_tls_server_name() {
        let out = rewrite_uri(
            "mongodb://host:27017/db",
            &mapping("host", 27017, 55005),
        )
        .unwrap();
        assert!(!out.contains("tlsServerName"));
        assert!(!out.contains('?'));
    }

    #[test]
    fn rewrite_default_port_when_absent() {
        let out = rewrite_uri(
            "mongodb://host/db",
            &mapping("host", 27017, 55006),
        )
        .unwrap();
        assert_eq!(out, "mongodb://127.0.0.1:55006/db");
    }

    #[test]
    fn rewrite_rejects_srv() {
        let err = rewrite_uri(
            "mongodb+srv://cluster.mongodb.net/admin",
            &HashMap::new(),
        )
        .unwrap_err();
        assert!(matches!(err, SshError::SrvNotSupported));
    }

    #[test]
    fn rewrite_rejects_multi_seed() {
        let err = rewrite_uri(
            "mongodb://a:27017,b:27017/admin",
            &HashMap::new(),
        )
        .unwrap_err();
        assert!(matches!(err, SshError::MultiSeedNotSupported));
    }

    #[test]
    fn extract_hosts_single() {
        let hosts = extract_hosts("mongodb://db.internal:27017/admin").unwrap();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "db.internal");
        assert_eq!(hosts[0].port, 27017);
    }

    #[test]
    fn extract_hosts_rejects_srv() {
        assert!(matches!(
            extract_hosts("mongodb+srv://cluster.foo/admin").unwrap_err(),
            SshError::SrvNotSupported
        ));
    }

    #[test]
    fn extract_hosts_rejects_multi_seed() {
        assert!(matches!(
            extract_hosts("mongodb://a:27017,b:27017/admin").unwrap_err(),
            SshError::MultiSeedNotSupported
        ));
    }

    #[test]
    fn rewrite_tls_true_does_not_duplicate_existing_tls_server_name() {
        // §6.4 / S3: if the user already set tlsServerName, do not append a second one.
        let out = rewrite_uri(
            "mongodb://user:pw@db.internal:27017/admin?tls=true&tlsServerName=custom.host",
            &mapping("db.internal", 27017, 55007),
        )
        .unwrap();
        // Must contain tlsServerName exactly once.
        assert_eq!(out.matches("tlsServerName=").count(), 1, "must not duplicate tlsServerName");
        assert!(out.contains("tlsServerName=custom.host"), "must preserve user-set value");
    }

    #[test]
    fn rewrite_tls_server_name_check_is_case_insensitive() {
        // Mixed-case key in the URI should still be detected.
        let out = rewrite_uri(
            "mongodb://host:27017/db?tls=true&tlsServerName=myhost",
            &mapping("host", 27017, 55008),
        )
        .unwrap();
        assert_eq!(out.matches("tlsServerName=").count(), 1, "case-insensitive dedup");
    }

    #[test]
    fn parse_host_token_default_port() {
        let hp = parse_host_token("localhost").unwrap();
        assert_eq!(hp.host, "localhost");
        assert_eq!(hp.port, 27017);
    }

    #[test]
    fn parse_host_token_with_port() {
        let hp = parse_host_token("db.internal:27100").unwrap();
        assert_eq!(hp.host, "db.internal");
        assert_eq!(hp.port, 27100);
    }
}
