use crate::db::connections::ConnectionRecord;
use crate::logctx;
use crate::logger::Logger;
use crate::state::AppState;
use tauri::State;

pub mod authz;
pub mod fallback;
pub mod strategies;

pub fn build_uri(rec: &ConnectionRecord, password: Option<&str>) -> String {
    if let Some(cs) = &rec.conn_string {
        if !cs.is_empty() {
            return cs.clone();
        }
    }
    let host = rec.host.clone().unwrap_or_else(|| "localhost".into());
    let port = rec.port.unwrap_or(27017);
    let auth_db = rec.auth_db.clone().unwrap_or_else(|| "admin".into());
    match (&rec.username, password) {
        (Some(u), Some(p)) if !u.is_empty() => {
            let u_enc = urlencoding_encode(u);
            let p_enc = urlencoding_encode(p);
            format!("mongodb://{}:{}@{}:{}/{}", u_enc, p_enc, host, port, auth_db)
        }
        _ => format!("mongodb://{}:{}/{}", host, port, auth_db),
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub async fn ping(uri: &str, log: &dyn Logger) -> Result<(), String> {
    log.info("mongo ping", logctx! { "uri" => uri });
    // connect_with_fallback already pings admin as part of validating the connection.
    fallback::connect_with_fallback(uri, log).await.map(|_| ())
}

pub async fn client_for(uri: &str, log: &dyn Logger) -> Result<mongodb::Client, String> {
    log.info("mongo connect", logctx! { "uri" => uri });
    fallback::connect_with_fallback(uri, log).await
}

/// Best-effort default-database name for a connection (used when listDatabases is unauthorized).
/// Parses the path component of a MongoDB URI (the segment after the host, before any query
/// string), falling back to the configured `auth_db`. We deliberately scan past the `://`
/// scheme separator so that schemes without a path component (e.g. `mongodb+srv://cluster.foo`)
/// don't surface the host as a "database".
pub fn default_db(rec: &ConnectionRecord) -> Option<String> {
    if let Some(cs) = &rec.conn_string {
        if let Some(scheme_end) = cs.find("://") {
            let after_scheme = &cs[scheme_end + 3..];
            if let Some(slash) = after_scheme.find('/') {
                let path = &after_scheme[slash + 1..];
                let db = path.split('?').next().unwrap_or("");
                if !db.is_empty() && db != "admin" {
                    return Some(db.to_string());
                }
            }
        }
    }
    rec.auth_db.clone().filter(|d| !d.is_empty() && d != "admin")
}

pub fn active_client(state: &State<'_, AppState>, id: &str) -> Result<mongodb::Client, String> {
    state
        .mongo_clients
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| "connection not active — connect first".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec() -> ConnectionRecord {
        ConnectionRecord {
            id: "1".into(),
            name: "t".into(),
            host: Some("example.com".into()),
            port: Some(27018),
            auth_db: Some("mydb".into()),
            username: Some("alice".into()),
            conn_string: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_key_path: None,
            created_at: "2026-04-17".into(),
        }
    }

    #[test]
    fn uri_with_password() {
        let u = build_uri(&rec(), Some("p@ss"));
        assert_eq!(u, "mongodb://alice:p%40ss@example.com:27018/mydb");
    }

    #[test]
    fn uri_without_password() {
        let mut r = rec();
        r.username = None;
        assert_eq!(build_uri(&r, None), "mongodb://example.com:27018/mydb");
    }

    #[test]
    fn conn_string_overrides() {
        let mut r = rec();
        r.conn_string = Some("mongodb+srv://cluster.foo/admin".into());
        assert_eq!(build_uri(&r, Some("x")), "mongodb+srv://cluster.foo/admin");
    }
}

#[cfg(test)]
mod default_db_tests {
    use super::*;
    fn rec() -> ConnectionRecord {
        ConnectionRecord {
            id: "1".into(), name: "t".into(),
            host: None, port: None, auth_db: None, username: None,
            conn_string: None, ssh_host: None, ssh_port: None, ssh_user: None,
            ssh_key_path: None, created_at: "x".into(),
        }
    }
    #[test]
    fn pulls_default_db_from_uri() {
        let mut r = rec();
        r.conn_string = Some("mongodb://u:p@h:1/marketplace?authSource=admin".into());
        assert_eq!(default_db(&r), Some("marketplace".into()));
    }
    #[test]
    fn falls_back_to_auth_db() {
        let mut r = rec();
        r.auth_db = Some("foo".into());
        assert_eq!(default_db(&r), Some("foo".into()));
    }
    #[test]
    fn admin_is_not_useful() {
        let mut r = rec();
        r.auth_db = Some("admin".into());
        assert_eq!(default_db(&r), None);
    }

    #[test]
    fn srv_uri_without_path_does_not_leak_host() {
        let mut r = rec();
        r.conn_string = Some("mongodb+srv://cluster.foo".into());
        assert_eq!(default_db(&r), None);
    }

    #[test]
    fn standard_uri_without_path_does_not_leak_host() {
        let mut r = rec();
        r.conn_string = Some("mongodb://h:27017".into());
        assert_eq!(default_db(&r), None);
    }

    #[test]
    fn srv_uri_with_empty_path_and_query_returns_none() {
        let mut r = rec();
        r.conn_string =
            Some("mongodb+srv://user:pw@cluster.mongodb.net/?retryWrites=true".into());
        assert_eq!(default_db(&r), None);
    }

    #[test]
    fn standard_uri_with_explicit_db_path() {
        let mut r = rec();
        r.conn_string = Some("mongodb://h/marketplace".into());
        assert_eq!(default_db(&r), Some("marketplace".into()));
    }
}
