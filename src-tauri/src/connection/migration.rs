//! Migration runner: legacy flat `ConnectionRecord` → v2 tagged-union
//! [`Connection`] + secret re-key into the slotted store.
//!
//! Mirrors the TS migrator at `src/connection/migration.ts` (and is
//! locked to it by the paired fixtures under `tests/fixtures/connection/
//! {legacy,migrated}/`). The migration rules — kept here verbatim to keep
//! the two implementations diff-able — are:
//!
//!   * `connString` present  → `target = uri`, `auth = none`
//!   * `connString` absent + `username` → `target = direct{host, port}`,
//!     `auth = scram{username, authDb ?? "admin", mechanism: auto}`
//!   * `connString` absent + no `username` → `target = direct`, `auth = none`
//!   * `sshHost` present → `ssh` block with `auth = key{keyPath: sshKeyPath ?? "",
//!     hasPassphrase: false}` and `knownHostsPolicy = "add-and-trust"`
//!     (the old code did not enforce host-key checking — promoting to
//!     `"strict"` on migration would break existing users)
//!   * `tls` / `proxy` / `overrides` are omitted (no legacy source).
//!
//! ## Sync semantics
//!
//! [`sync_row_to_v2`] is invoked **alongside** every legacy save, not in
//! place of it. The legacy `connections` row and the legacy keychain
//! entry remain untouched so the old dialog keeps working unchanged.
//! The v2 store gets a fresh `upsert` and, if a legacy password is
//! available, the password is *also* written to
//! [`SecretSlot::AuthPassword`] for the same connection id. Old and new
//! coexist until Phase 2 cuts over.
//!
//! Sync failures **do not surface to the user**: the caller (create or
//! update command) logs a warning and returns success — the v2 path is
//! catching up in the background, the legacy save already succeeded.

use rusqlite::Connection as SqliteConnection;
use thiserror::Error;

use crate::connection::model::{
    AuthMode, Connection, ConnectionTarget, KnownHostsPolicy, ScramMechanism, SshAuth, SshTunnel,
};
use crate::connection::secrets::{SecretError, SecretSlot, SecretStore};
use crate::connection::store::{self, StoreError};
use crate::logctx;
use crate::logger::Logger;

// `ConnectionRecord` + the minimal SQL surface needed by `migrate_all`
// live in a private submodule here. They used to live in `db::connections`
// (deleted in PR 5 along with the legacy IPC). Bringing them in-module
// keeps the bootstrap migration self-contained — no other code in the
// crate touches the legacy `connections` table directly anymore.
use legacy_db::ConnectionRecord;

// ──────────────────────────────────────────────────────────────────────────
// Constants — kept in sync with src/connection/migration.ts
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_HOST: &str = "localhost";
const DEFAULT_PORT: u16 = 27017;
const DEFAULT_AUTH_DB: &str = "admin";
const DEFAULT_SSH_PORT: u16 = 22;
/// Migrated SSH rows opt into `add-and-trust` rather than `strict` to match
/// the legacy code's lack of host-key enforcement. New connections default
/// to `strict` (set in the v2 dialog, not here).
const MIGRATED_SSH_HOST_KEY_POLICY: KnownHostsPolicy = KnownHostsPolicy::AddAndTrust;

// ──────────────────────────────────────────────────────────────────────────
// Error type
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum MigrationError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("secret error: {0}")]
    Secret(#[from] SecretError),
}

// ──────────────────────────────────────────────────────────────────────────
// Pure migrator
// ──────────────────────────────────────────────────────────────────────────

/// Convert a legacy [`ConnectionRecord`] to the v2 tagged-union
/// [`Connection`]. Pure — no I/O.
pub fn migrate(legacy: &ConnectionRecord) -> Connection {
    let target = build_target(legacy);
    let auth = build_auth(legacy);
    let ssh = build_ssh(legacy);

    Connection {
        id: legacy.id.clone(),
        name: legacy.name.clone(),
        color: None,
        target,
        auth,
        tls: None,
        ssh,
        proxy: None,
        overrides: None,
        created_at: legacy.created_at.clone(),
    }
}

fn build_target(legacy: &ConnectionRecord) -> ConnectionTarget {
    match legacy.conn_string.as_deref() {
        Some(uri) if !uri.is_empty() => ConnectionTarget::Uri {
            uri: uri.to_string(),
        },
        _ => ConnectionTarget::Direct {
            host: legacy
                .host
                .clone()
                .unwrap_or_else(|| DEFAULT_HOST.to_string()),
            port: to_u16_or(legacy.port, DEFAULT_PORT),
            replica_set: None,
            read_preference: None,
            direct_connection: None,
        },
    }
}

fn build_auth(legacy: &ConnectionRecord) -> AuthMode {
    // URI carries credentials; legacy direct row with username implies SCRAM.
    if matches!(legacy.conn_string.as_deref(), Some(s) if !s.is_empty()) {
        return AuthMode::None;
    }
    match legacy.username.as_deref() {
        Some(user) if !user.is_empty() => AuthMode::Scram {
            username: user.to_string(),
            auth_db: legacy
                .auth_db
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| DEFAULT_AUTH_DB.to_string()),
            mechanism: Some(ScramMechanism::Auto),
        },
        _ => AuthMode::None,
    }
}

fn build_ssh(legacy: &ConnectionRecord) -> Option<SshTunnel> {
    let host = legacy.ssh_host.as_deref().filter(|s| !s.is_empty())?;
    Some(SshTunnel {
        // Migrated tunnels were active in the legacy app — keep them enabled.
        enabled: true,
        host: host.to_string(),
        port: to_u16_or(legacy.ssh_port, DEFAULT_SSH_PORT),
        user: legacy.ssh_user.clone().unwrap_or_default(),
        auth: SshAuth::Key {
            key_path: legacy.ssh_key_path.clone().unwrap_or_default(),
            has_passphrase: false,
        },
        known_hosts_policy: MIGRATED_SSH_HOST_KEY_POLICY,
    })
}

/// Cast a SQLite `INTEGER` (`Option<i64>`) to `u16` with bounds protection.
/// Out-of-range values fall back to the default so a corrupted row can't
/// produce a wrap-around port.
fn to_u16_or(value: Option<i64>, default: u16) -> u16 {
    match value {
        Some(n) if (0..=u16::MAX as i64).contains(&n) => n as u16,
        _ => default,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Side-effectful sync
// ──────────────────────────────────────────────────────────────────────────

/// Migrate one legacy row into v2: upsert the payload row in
/// `connections_v2`, and (if a legacy password is supplied and non-empty)
/// write it to `SecretSlot::AuthPassword` for the same connection id.
///
/// Private to the module: the prior external caller (legacy
/// `commands::connection::sync_v2_after_save`) was deleted in PR 5. The
/// only remaining caller is `migrate_all` below, which sweeps the legacy
/// table at app boot. In-module tests also drive it directly.
fn sync_row_to_v2<S: SecretStore + ?Sized>(
    sqlite: &SqliteConnection,
    secrets: &S,
    legacy: &ConnectionRecord,
    legacy_password: Option<&str>,
) -> Result<Connection, MigrationError> {
    let connection = migrate(legacy);
    store::upsert(sqlite, &connection)?;
    if let Some(password) = legacy_password {
        if !password.is_empty() {
            secrets.set(&connection.id, SecretSlot::AuthPassword, password)?;
        }
    }
    Ok(connection)
}

/// Per-row outcome aggregated by [`migrate_all`].
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct MigrationSummary {
    /// Legacy rows visited.
    pub total: usize,
    /// Rows whose v2 payload row was upserted successfully (regardless of
    /// whether a secret was also written).
    pub migrated: usize,
    /// Rows where the legacy password fetch failed — the v2 row was still
    /// upserted, but the secret was not re-keyed. The user will be
    /// prompted on next connect via the v2 dialog.
    pub skipped_secret: usize,
    /// Rows whose v2 upsert itself failed (store error). The legacy row
    /// is unaffected; the next save attempt will retry.
    pub failed: usize,
}

/// Sweep every row in the legacy `connections` table and call
/// [`sync_row_to_v2`] for each. Used at app boot (gated on `CONN_V2`).
///
/// Failures are logged and counted; this function never returns an error
/// from a per-row failure — only from the initial legacy-list query.
/// Idempotent: re-running is a series of upserts with no observable side
/// effects beyond bumping `updated_at`.
pub fn migrate_all(
    sqlite: &SqliteConnection,
    secrets: &dyn SecretStore,
    legacy_password_fetch: &dyn Fn(&str) -> Result<Option<String>, String>,
    log: &dyn Logger,
) -> Result<MigrationSummary, rusqlite::Error> {
    let legacy_rows = legacy_db::list(sqlite)?;
    let mut summary = MigrationSummary {
        total: legacy_rows.len(),
        ..Default::default()
    };

    for row in &legacy_rows {
        let password = match legacy_password_fetch(&row.id) {
            Ok(value) => value,
            Err(err) => {
                log.warn(
                    "legacy password fetch failed; migrating row without secret",
                    logctx! { "connId" => row.id.clone(), "err" => err },
                );
                summary.skipped_secret += 1;
                None
            }
        };

        match sync_row_to_v2(sqlite, secrets, row, password.as_deref()) {
            Ok(_) => summary.migrated += 1,
            Err(err) => {
                log.warn(
                    "legacy row migration failed",
                    logctx! { "connId" => row.id.clone(), "err" => err.to_string() },
                );
                summary.failed += 1;
            }
        }
    }

    log.info(
        "migrate_all complete",
        logctx! {
            "total" => summary.total,
            "migrated" => summary.migrated,
            "skippedSecret" => summary.skipped_secret,
            "failed" => summary.failed,
        },
    );
    Ok(summary)
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::secrets::MemStore;
    use crate::db::open_in_memory;
    use crate::logger::MemoryLogger;
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};

    // ── Fixture-paired migrate() tests ────────────────────────────────────

    fn fixtures_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri parent")
            .join("tests")
            .join("fixtures")
            .join("connection")
    }

    fn load_pair(name: &str) -> (ConnectionRecord, Value) {
        let legacy_path = fixtures_root().join("legacy").join(format!("{name}.json"));
        let migrated_path = fixtures_root().join("migrated").join(format!("{name}.json"));
        let legacy_raw =
            fs::read_to_string(&legacy_path).unwrap_or_else(|e| panic!("read {legacy_path:?}: {e}"));
        let migrated_raw = fs::read_to_string(&migrated_path)
            .unwrap_or_else(|e| panic!("read {migrated_path:?}: {e}"));
        let legacy: ConnectionRecord = serde_json::from_str(&legacy_raw)
            .unwrap_or_else(|e| panic!("parse legacy {name}: {e}\n{legacy_raw}"));
        let migrated: Value = serde_json::from_str(&migrated_raw)
            .unwrap_or_else(|e| panic!("parse migrated {name}: {e}"));
        (legacy, migrated)
    }

    fn assert_pair_matches(name: &str) {
        let (legacy, expected) = load_pair(name);
        let migrated = migrate(&legacy);
        let actual = serde_json::to_value(&migrated).expect("serialize migrated");
        assert_eq!(
            actual, expected,
            "fixture pair '{name}' diverged\n  expected: {}\n  actual:   {}",
            serde_json::to_string_pretty(&expected).unwrap(),
            serde_json::to_string_pretty(&actual).unwrap(),
        );
    }

    #[test]
    fn pair_host_no_auth() {
        assert_pair_matches("host-no-auth");
    }
    #[test]
    fn pair_host_scram() {
        assert_pair_matches("host-scram");
    }
    #[test]
    fn pair_host_scram_missing_authdb() {
        assert_pair_matches("host-scram-missing-authdb");
    }
    #[test]
    fn pair_host_scram_with_ssh_key() {
        assert_pair_matches("host-scram-with-ssh-key");
    }
    #[test]
    fn pair_uri_only() {
        assert_pair_matches("uri-only");
    }
    #[test]
    fn pair_uri_with_ssh_key() {
        assert_pair_matches("uri-with-ssh-key");
    }

    // ── Edge cases not covered by the fixture matrix ──────────────────────

    fn bare(id: &str, name: &str) -> ConnectionRecord {
        ConnectionRecord {
            id: id.into(),
            name: name.into(),
            host: None,
            port: None,
            auth_db: None,
            username: None,
            conn_string: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_key_path: None,
            created_at: "2026-05-28T00:00:00Z".into(),
        }
    }

    #[test]
    fn migrate_defaults_host_and_port_when_absent() {
        let result = migrate(&bare("c1", "n"));
        match result.target {
            ConnectionTarget::Direct { host, port, .. } => {
                assert_eq!(host, "localhost");
                assert_eq!(port, 27017);
            }
            other => panic!("expected Direct, got {other:?}"),
        }
        assert_eq!(result.auth, AuthMode::None);
        assert!(result.ssh.is_none());
    }

    #[test]
    fn migrate_clamps_out_of_range_port_to_default() {
        let mut legacy = bare("c1", "n");
        legacy.port = Some(99_999); // > u16::MAX
        legacy.ssh_host = Some("bastion".into());
        legacy.ssh_port = Some(-1); // negative
        let result = migrate(&legacy);
        let port = match &result.target {
            ConnectionTarget::Direct { port, .. } => *port,
            _ => unreachable!(),
        };
        assert_eq!(port, 27017, "out-of-range mongo port must clamp to default");
        let ssh_port = result.ssh.as_ref().expect("ssh present").port;
        assert_eq!(ssh_port, 22, "negative ssh port must clamp to default");
    }

    #[test]
    fn migrate_empty_username_treated_as_no_auth() {
        let mut legacy = bare("c1", "n");
        legacy.username = Some(String::new());
        assert_eq!(migrate(&legacy).auth, AuthMode::None);
    }

    #[test]
    fn migrate_empty_authdb_falls_back_to_admin() {
        let mut legacy = bare("c1", "n");
        legacy.username = Some("alice".into());
        legacy.auth_db = Some(String::new());
        match migrate(&legacy).auth {
            AuthMode::Scram { auth_db, .. } => assert_eq!(auth_db, "admin"),
            other => panic!("expected Scram, got {other:?}"),
        }
    }

    // ── sync_row_to_v2 ────────────────────────────────────────────────────

    fn seed_legacy_row(sqlite: &SqliteConnection, rec: &ConnectionRecord) {
        legacy_db::insert(sqlite, rec).unwrap();
    }

    #[test]
    fn sync_writes_v2_row_and_keychain_slot() {
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let mut legacy = bare("c1", "with-pw");
        legacy.host = Some("db.example".into());
        legacy.username = Some("alice".into());
        seed_legacy_row(&sqlite, &legacy);

        let connection = sync_row_to_v2(&sqlite, &secrets, &legacy, Some("hunter2")).unwrap();

        assert_eq!(connection.id, "c1");
        let from_store = store::get(&sqlite, "c1").unwrap().expect("v2 row missing");
        assert_eq!(from_store, connection);

        let pw = secrets
            .get("c1", SecretSlot::AuthPassword)
            .unwrap()
            .expect("secret missing");
        assert_eq!(pw, "hunter2");
    }

    #[test]
    fn sync_does_not_write_secret_when_password_is_none() {
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let legacy = bare("c1", "no-pw");
        seed_legacy_row(&sqlite, &legacy);

        sync_row_to_v2(&sqlite, &secrets, &legacy, None).unwrap();

        assert!(store::get(&sqlite, "c1").unwrap().is_some());
        assert!(secrets
            .get("c1", SecretSlot::AuthPassword)
            .unwrap()
            .is_none());
    }

    #[test]
    fn sync_does_not_write_secret_when_password_is_empty() {
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let legacy = bare("c1", "empty-pw");
        seed_legacy_row(&sqlite, &legacy);

        sync_row_to_v2(&sqlite, &secrets, &legacy, Some("")).unwrap();

        assert!(store::get(&sqlite, "c1").unwrap().is_some());
        assert!(secrets
            .get("c1", SecretSlot::AuthPassword)
            .unwrap()
            .is_none());
    }

    #[test]
    fn sync_does_not_touch_legacy_secret_or_row() {
        // sync is *additive* — the legacy row and (here, simulated) legacy
        // keychain entry must survive untouched.
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let mut legacy = bare("c1", "additive");
        legacy.host = Some("db".into());
        seed_legacy_row(&sqlite, &legacy);

        sync_row_to_v2(&sqlite, &secrets, &legacy, Some("pw")).unwrap();

        // Legacy row still intact (same shape, not deleted).
        let still_there = legacy_db::get(&sqlite, "c1").unwrap().expect("legacy gone");
        assert_eq!(still_there.id, "c1");
        assert_eq!(still_there.host.as_deref(), Some("db"));
    }

    // ── migrate_all ───────────────────────────────────────────────────────

    fn pw_for_c1_only(id: &str) -> Result<Option<String>, String> {
        Ok(if id == "c1" { Some("pw1".to_string()) } else { None })
    }

    #[test]
    fn migrate_all_sweeps_every_legacy_row() {
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let log = MemoryLogger::new("test");

        // Two rows with various shapes.
        seed_legacy_row(&sqlite, &{
            let mut r = bare("c1", "first");
            r.host = Some("db1".into());
            r.username = Some("alice".into());
            r
        });
        seed_legacy_row(&sqlite, &{
            let mut r = bare("c2", "second");
            r.conn_string = Some("mongodb://x/y".into());
            r
        });

        let summary = migrate_all(&sqlite, &secrets, &pw_for_c1_only, log.as_ref()).unwrap();
        assert_eq!(summary.total, 2);
        assert_eq!(summary.migrated, 2);
        assert_eq!(summary.failed, 0);
        assert_eq!(summary.skipped_secret, 0);

        // Both v2 rows present.
        assert!(store::get(&sqlite, "c1").unwrap().is_some());
        assert!(store::get(&sqlite, "c2").unwrap().is_some());

        // Only c1 has a password.
        assert_eq!(
            secrets
                .get("c1", SecretSlot::AuthPassword)
                .unwrap()
                .as_deref(),
            Some("pw1")
        );
        assert!(secrets
            .get("c2", SecretSlot::AuthPassword)
            .unwrap()
            .is_none());
    }

    #[test]
    fn migrate_all_counts_password_fetch_failures_as_skipped_secret() {
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let log = MemoryLogger::new("test");

        seed_legacy_row(&sqlite, &bare("c1", "first"));

        let always_err = |_id: &str| -> Result<Option<String>, String> {
            Err("keychain locked".to_string())
        };
        let summary = migrate_all(&sqlite, &secrets, &always_err, log.as_ref()).unwrap();

        // Row still migrated (the upsert succeeds without the password);
        // just the secret was skipped.
        assert_eq!(summary.total, 1);
        assert_eq!(summary.migrated, 1);
        assert_eq!(summary.skipped_secret, 1);
        assert_eq!(summary.failed, 0);
        assert!(store::get(&sqlite, "c1").unwrap().is_some());
        assert!(secrets
            .get("c1", SecretSlot::AuthPassword)
            .unwrap()
            .is_none());
    }

    #[test]
    fn migrate_all_is_idempotent() {
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let log = MemoryLogger::new("test");
        seed_legacy_row(&sqlite, &bare("c1", "first"));

        let first = migrate_all(&sqlite, &secrets, &pw_for_c1_only, log.as_ref()).unwrap();
        let second = migrate_all(&sqlite, &secrets, &pw_for_c1_only, log.as_ref()).unwrap();

        assert_eq!(first.migrated, 1);
        assert_eq!(second.migrated, 1);

        // Exactly one v2 row regardless of how many sweeps happened.
        // (Post-PR-5 the v2 table is named `connections`; this test was
        // written against the dual-table phase's `connections_v2`.)
        let count: i64 = sqlite
            .query_row("SELECT COUNT(*) FROM connections", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migrate_all_handles_empty_legacy_table() {
        let sqlite = open_in_memory().unwrap();
        let secrets = MemStore::new();
        let log = MemoryLogger::new("test");

        let summary = migrate_all(&sqlite, &secrets, &pw_for_c1_only, log.as_ref()).unwrap();
        assert_eq!(summary, MigrationSummary::default());
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Legacy-table read surface
//
// Previously lived in `db::connections` (deleted in PR 5). Bringing it
// in here keeps the bootstrap migration self-contained: the rest of the
// crate has moved off `ConnectionRecord` entirely, and this submodule is
// the only place the legacy column layout is still touched. The
// `connections` table name is hardcoded here for now; Task 20's atomic
// rename migration will retarget this at `connections_v1_backup`.
mod legacy_db {
    // `params!` is only used by the test-only insert/get helpers; gate
    // the import so prod builds don't warn about an unused symbol.
    #[cfg(test)]
    use rusqlite::params;
    use rusqlite::{Connection, Row};
    use serde::{Deserialize, Serialize};

    /// Legacy flat-column row shape. Kept here only so the bootstrap
    /// migration can read pre-v2 data; never written by current code.
    /// `Serialize` retained for the migration's fixture-based unit tests
    /// (paired with the `legacy/*.json` fixtures under
    /// `tests/fixtures/connection/`).
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ConnectionRecord {
        pub id: String,
        pub name: String,
        pub host: Option<String>,
        pub port: Option<i64>,
        pub auth_db: Option<String>,
        pub username: Option<String>,
        pub conn_string: Option<String>,
        pub ssh_host: Option<String>,
        pub ssh_port: Option<i64>,
        pub ssh_user: Option<String>,
        pub ssh_key_path: Option<String>,
        pub created_at: String,
    }

    fn map_row(row: &Row) -> rusqlite::Result<ConnectionRecord> {
        Ok(ConnectionRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            host: row.get(2)?,
            port: row.get(3)?,
            auth_db: row.get(4)?,
            username: row.get(5)?,
            conn_string: row.get(6)?,
            ssh_host: row.get(7)?,
            ssh_port: row.get(8)?,
            ssh_user: row.get(9)?,
            ssh_key_path: row.get(10)?,
            created_at: row.get(11)?,
        })
    }

    // All reads target `connections_v1_backup` — the post-rename home of
    // the pre-PR-5 legacy table. `db::migrate.rs` always ensures the
    // backup table exists (creating it empty on fresh installs), so this
    // module never has to guard against a missing table.

    pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ConnectionRecord>> {
        let mut stmt = conn.prepare(
            "SELECT id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at
             FROM connections_v1_backup ORDER BY name",
        )?;
        let rows = stmt.query_map([], map_row)?;
        rows.collect()
    }

    #[cfg(test)]
    pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<ConnectionRecord>> {
        let mut stmt = conn.prepare(
            "SELECT id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at
             FROM connections_v1_backup WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], map_row)?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    }

    #[cfg(test)]
    pub fn insert(conn: &Connection, rec: &ConnectionRecord) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO connections_v1_backup (id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                rec.id, rec.name, rec.host, rec.port, rec.auth_db, rec.username,
                rec.conn_string, rec.ssh_host, rec.ssh_port, rec.ssh_user, rec.ssh_key_path,
                rec.created_at,
            ],
        )?;
        Ok(())
    }
}
