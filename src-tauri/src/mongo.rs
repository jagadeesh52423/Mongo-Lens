use crate::db::connections::ConnectionRecord;
use crate::state::AppState;
use tauri::State;

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

pub async fn ping(uri: &str) -> Result<(), String> {
    use mongodb::{options::ClientOptions, Client};
    let opts = ClientOptions::parse(uri).await.map_err(|e| e.to_string())?;
    let client = Client::with_options(opts).map_err(|e| e.to_string())?;
    client
        .database("admin")
        .run_command(mongodb::bson::doc! {"ping": 1})
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn client_for(uri: &str) -> Result<mongodb::Client, String> {
    use mongodb::{options::ClientOptions, Client};
    let opts = ClientOptions::parse(uri).await.map_err(|e| e.to_string())?;
    Client::with_options(opts).map_err(|e| e.to_string())
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
