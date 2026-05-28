//! SQLite-backed payload-JSON store for the v2 connection model.
//!
//! One table (`connections`, see [`SCHEMA_SQL`]); one row per
//! `Connection`. The full tagged-union JSON lives in the `payload`
//! column; `id` and `name` are projected so list/sort stays cheap.
//!
//! Pre-PR-5 the table was named `connections_v2` and coexisted with a
//! legacy flat-column `connections` table. PR 5's `db::migrate.rs` ran a
//! one-shot rename so the v2 schema is now the canonical `connections`;
//! the legacy archive lives at `connections_v1_backup`.
//!
//! Errors funnel through [`StoreError`], which wraps the two real
//! failure modes — SQLite I/O and JSON encode/decode — so callers can
//! `?` either kind without juggling two error types.

use rusqlite::{params, Connection as SqliteConnection, Row};
use thiserror::Error;

use super::model::Connection;

/// CREATE TABLE / CREATE INDEX statements for the v2 store.
///
/// Reused by [`apply_schema`] (for tests and any code that needs a
/// store-only SQLite handle) and by `db::migrate` (for the real app DB).
pub const SCHEMA_SQL: &str = include_str!("schema_v2.sql");

/// Apply the v2 schema to a SQLite handle. Idempotent: re-runs are no-ops
/// because every statement uses `IF NOT EXISTS`.
pub fn apply_schema(conn: &SqliteConnection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("payload (de)serialize error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Decode the `payload` JSON in a row to a typed [`Connection`].
fn map_row(row: &Row) -> Result<Connection> {
    let payload: String = row.get("payload")?;
    Ok(serde_json::from_str(&payload)?)
}

/// Return every stored connection, sorted by `name` (then `id` for a
/// stable secondary order when names collide).
pub fn list(conn: &SqliteConnection) -> Result<Vec<Connection>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, payload, created_at, updated_at \
         FROM connections \
         ORDER BY name COLLATE NOCASE ASC, id ASC",
    )?;
    let mut rows = stmt.query([])?;
    let mut out: Vec<Connection> = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(map_row(row)?);
    }
    Ok(out)
}

/// Fetch one connection by id. `Ok(None)` if no row exists.
pub fn get(conn: &SqliteConnection, id: &str) -> Result<Option<Connection>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, payload, created_at, updated_at \
         FROM connections WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(map_row(row)?)),
        None => Ok(None),
    }
}

/// Insert a new connection, or update the existing one with the same id.
///
/// `created_at` from `connection.created_at` is used on first insert and
/// preserved on update (the `ON CONFLICT` clause never touches it).
/// `updated_at` is set to `now_utc()` on every write so downstream sync
/// (Task 11) can detect drift.
pub fn upsert(conn: &SqliteConnection, connection: &Connection) -> Result<()> {
    let payload = serde_json::to_string(connection)?;
    let now = now_utc();
    conn.execute(
        "INSERT INTO connections (id, name, payload, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(id) DO UPDATE SET \
             name       = excluded.name, \
             payload    = excluded.payload, \
             updated_at = excluded.updated_at",
        params![
            connection.id,
            connection.name,
            payload,
            connection.created_at,
            now,
        ],
    )?;
    Ok(())
}

/// Delete a connection by id. Succeeds (no-op) if the id is unknown — the
/// caller can `get` first if they need to distinguish.
pub fn delete(conn: &SqliteConnection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM connections WHERE id = ?1", params![id])?;
    Ok(())
}

/// Current UTC time formatted as RFC 3339 — matches the wire format
/// used elsewhere in the model (`Connection.created_at`).
fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::model::{AuthMode, ConnectionTarget, ScramMechanism};

    /// Fresh in-memory SQLite handle with the v2 schema applied. Each
    /// test gets its own — no shared state between tests.
    fn fresh_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().expect("open in-memory sqlite");
        apply_schema(&conn).expect("apply v2 schema");
        conn
    }

    fn sample_direct(id: &str, name: &str) -> Connection {
        Connection {
            id: id.into(),
            name: name.into(),
            color: None,
            target: ConnectionTarget::Direct {
                host: "localhost".into(),
                port: 27017,
                replica_set: None,
                read_preference: None,
                direct_connection: None,
            },
            auth: AuthMode::None,
            tls: None,
            ssh: None,
            proxy: None,
            overrides: None,
            created_at: "2026-05-28T00:00:00Z".into(),
        }
    }

    fn sample_scram(id: &str, name: &str) -> Connection {
        Connection {
            id: id.into(),
            name: name.into(),
            color: Some("#ff7a00".into()),
            target: ConnectionTarget::Direct {
                host: "db.example".into(),
                port: 27017,
                replica_set: Some("rs0".into()),
                read_preference: None,
                direct_connection: Some(false),
            },
            auth: AuthMode::Scram {
                username: "alice".into(),
                auth_db: "admin".into(),
                mechanism: Some(ScramMechanism::ScramSha256),
            },
            tls: None,
            ssh: None,
            proxy: None,
            overrides: None,
            created_at: "2026-05-27T12:00:00Z".into(),
        }
    }

    #[test]
    fn schema_is_idempotent() {
        let conn = fresh_db();
        // Re-applying must not error and must not duplicate the table.
        apply_schema(&conn).unwrap();
        apply_schema(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connections'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn schema_creates_supporting_indexes() {
        let conn = fresh_db();
        // Index names retain the `_v2` suffix from before PR 5's table
        // rename — they're cosmetic identifiers, and renaming them
        // unnecessarily would invalidate existing users' indexes on
        // first boot after upgrade.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type='index' AND name IN ('idx_connections_v2_name', 'idx_connections_v2_updated_at')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn upsert_then_get_round_trips_payload() {
        let conn = fresh_db();
        let original = sample_scram("c1", "scram-conn");
        upsert(&conn, &original).unwrap();

        let fetched = get(&conn, "c1").unwrap().expect("row should exist");
        assert_eq!(fetched, original, "stored payload must round-trip exactly");
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let conn = fresh_db();
        assert!(get(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn list_returns_rows_sorted_by_name_case_insensitive() {
        let conn = fresh_db();
        upsert(&conn, &sample_direct("c1", "Zeta")).unwrap();
        upsert(&conn, &sample_direct("c2", "alpha")).unwrap();
        upsert(&conn, &sample_direct("c3", "Mike")).unwrap();

        let rows = list(&conn).unwrap();
        let names: Vec<&str> = rows.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Mike", "Zeta"]);
    }

    #[test]
    fn list_is_empty_on_fresh_db() {
        let conn = fresh_db();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn upsert_updates_existing_row_and_preserves_created_at() {
        let conn = fresh_db();
        upsert(&conn, &sample_direct("c1", "original")).unwrap();

        // Read the DB-side created_at so we can verify it's preserved.
        let initial_created_at: String = conn
            .query_row(
                "SELECT created_at FROM connections WHERE id='c1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Re-upsert with a different name AND a different created_at in
        // the payload — the DB column must keep the original value.
        let mut edited = sample_direct("c1", "renamed");
        edited.created_at = "2099-01-01T00:00:00Z".into();
        upsert(&conn, &edited).unwrap();

        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM connections", [], |row| row.get(0))
            .unwrap();
        assert_eq!(row_count, 1, "upsert must not create a duplicate row");

        let (name, db_created_at): (String, String) = conn
            .query_row(
                "SELECT name, created_at FROM connections WHERE id='c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "renamed", "name column must reflect the update");
        assert_eq!(
            db_created_at, initial_created_at,
            "created_at column must be preserved across upserts"
        );
    }

    #[test]
    fn upsert_bumps_updated_at() {
        let conn = fresh_db();
        upsert(&conn, &sample_direct("c1", "orig")).unwrap();
        let first: String = conn
            .query_row(
                "SELECT updated_at FROM connections WHERE id='c1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Sleep just long enough that RFC3339 (second resolution in the
        // worst case) is guaranteed to advance.
        std::thread::sleep(std::time::Duration::from_millis(1100));

        upsert(&conn, &sample_direct("c1", "edited")).unwrap();
        let second: String = conn
            .query_row(
                "SELECT updated_at FROM connections WHERE id='c1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!(
            second > first,
            "updated_at must advance on re-upsert (first={first}, second={second})"
        );
    }

    #[test]
    fn delete_removes_only_the_targeted_row() {
        let conn = fresh_db();
        upsert(&conn, &sample_direct("c1", "one")).unwrap();
        upsert(&conn, &sample_direct("c2", "two")).unwrap();

        delete(&conn, "c1").unwrap();

        assert!(get(&conn, "c1").unwrap().is_none(), "c1 must be gone");
        assert!(get(&conn, "c2").unwrap().is_some(), "c2 must remain");
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn delete_unknown_id_is_a_noop() {
        let conn = fresh_db();
        upsert(&conn, &sample_direct("c1", "one")).unwrap();
        delete(&conn, "does-not-exist").unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
    }
}
