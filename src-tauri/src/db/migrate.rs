use rusqlite::Connection;

use crate::connection::store as connection_store;

/// Run all DB migration steps. Idempotent: every step is safe to re-run on every boot.
///
/// Ordering matters:
///   1. **Rename step** — moves any pre-PR-5 legacy `connections` table aside
///      to `connections_v1_backup`, freeing the canonical name for the v2 schema.
///      No-op on fresh installs (no legacy table yet) and on subsequent boots
///      (`connections` already has the v2 shape). Also ensures
///      `connections_v1_backup` always exists (empty if no legacy data) so the
///      bootstrap migration (`connection::migration::migrate_all`) can run a
///      uniform `SELECT FROM connections_v1_backup` against every database
///      without conditional table-existence checks.
///   2. **v2 store schema** — owned by `src/connection/schema_v2.sql`. Creates
///      `connections` with the v2 (tagged-union payload) shape. Idempotent
///      (CREATE TABLE IF NOT EXISTS).
///   3. **saved_scripts** — unchanged from PR 4. Its `connection_id REFERENCES
///      connections(id)` FK rebinds automatically after the rename (SQLite
///      ≥3.25 updates FK target names atomically on ALTER TABLE RENAME).
pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    migrate_legacy_to_v1_backup(conn)?;

    connection_store::apply_schema(conn)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_scripts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT DEFAULT '',
            connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
            last_run_at TEXT,
            created_at TEXT NOT NULL
        );",
    )?;

    Ok(())
}

/// Move a pre-PR-5 legacy `connections` table out of the way so the v2 schema
/// can claim the canonical name. Also normalises the post-rename steady state
/// by ensuring `connections_v1_backup` always exists with the legacy column
/// layout — empty on fresh installs, populated on upgrades.
///
/// Decision matrix (all branches are no-ops on already-migrated boots):
///
/// | `connections` exists? | shape       | `_v1_backup` exists? | action                                                                     |
/// |-----------------------|-------------|----------------------|----------------------------------------------------------------------------|
/// | no                    | -           | no                   | create empty `_v1_backup`                                                  |
/// | no                    | -           | yes                  | no-op                                                                      |
/// | yes                   | v2 (payload)| no                   | create empty `_v1_backup` (rename was already done in a prior boot)         |
/// | yes                   | v2 (payload)| yes                   | no-op (steady state)                                                       |
/// | yes                   | legacy      | no                   | rename `connections` → `_v1_backup` (the upgrade case)                     |
/// | yes                   | legacy      | yes                   | drop the orphan legacy `connections` (backup is canonical archive)         |
fn migrate_legacy_to_v1_backup(conn: &Connection) -> rusqlite::Result<()> {
    let connections_exists = table_exists(conn, "connections")?;
    let backup_exists = table_exists(conn, "connections_v1_backup")?;

    // Shape detection — only meaningful when `connections` exists.
    // A v2 row layout has a `payload` column; legacy doesn't.
    let connections_is_v2 = if connections_exists {
        column_exists(conn, "connections", "payload")?
    } else {
        false
    };

    match (connections_exists, connections_is_v2, backup_exists) {
        (false, _, true) => {
            // Backup already exists; nothing to do.
        }
        (false, _, false) => {
            // Fresh install. Create the backup table empty so
            // migrate_all has a uniform `connections_v1_backup` to read.
            create_empty_legacy_backup(conn)?;
        }
        (true, true, true) => {
            // Steady state — nothing to do.
        }
        (true, true, false) => {
            // The rename ran in a prior boot but somehow the backup was
            // removed. Re-create the backup empty so legacy_db reads
            // don't fail; legacy rows are gone but that's already a
            // user-visible state.
            create_empty_legacy_backup(conn)?;
        }
        (true, false, false) => {
            // The upgrade case. Rename the legacy table aside.
            conn.execute(
                "ALTER TABLE connections RENAME TO connections_v1_backup",
                [],
            )?;
        }
        (true, false, true) => {
            // Orphan legacy table alongside a backup — drop the orphan;
            // the backup is the canonical archive.
            conn.execute("DROP TABLE connections", [])?;
        }
    }

    Ok(())
}

fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    // `pragma_table_info` is the documented way to introspect columns
    // portably; cleaner than parsing CREATE statements out of
    // `sqlite_master`.
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name=?2)",
        [table, column],
        |r| r.get(0),
    )
}

fn create_empty_legacy_backup(conn: &Connection) -> rusqlite::Result<()> {
    // Schema mirrors the pre-PR-5 `connections` table. Kept verbatim so
    // a future "read pre-v2 row by id" path (if ever needed for archive
    // inspection) sees the same columns the legacy code wrote.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS connections_v1_backup (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT,
            port INTEGER DEFAULT 27017,
            auth_db TEXT DEFAULT 'admin',
            username TEXT,
            conn_string TEXT,
            ssh_host TEXT,
            ssh_port INTEGER,
            ssh_user TEXT,
            ssh_key_path TEXT,
            created_at TEXT NOT NULL
        );",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
        rows.collect::<Result<_, _>>().unwrap()
    }

    #[test]
    fn fresh_install_yields_v2_connections_and_empty_v1_backup() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // `connections` is the v2 shape.
        let cols = column_names(&conn, "connections");
        assert!(
            cols.iter().any(|c| c == "payload"),
            "expected `payload` column on v2-shaped connections table; got {cols:?}"
        );
        // Backup table exists, empty.
        assert!(table_exists(&conn, "connections_v1_backup").unwrap());
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM connections_v1_backup", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        // saved_scripts exists and its FK target rebound to the new `connections`.
        assert!(table_exists(&conn, "saved_scripts").unwrap());
    }

    #[test]
    fn migrations_are_idempotent_on_second_run() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO connections (id, name, payload, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            [
                "c1",
                "t",
                "{}",
                "2026-05-28T00:00:00Z",
                "2026-05-28T00:00:00Z",
            ],
        )
        .unwrap();

        run_migrations(&conn).unwrap();

        // Row survived the second migration.
        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM connections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(row_count, 1, "row must survive a re-migration");
    }

    #[test]
    fn legacy_data_migrates_into_v1_backup() {
        let conn = Connection::open_in_memory().unwrap();
        // Simulate a pre-PR-5 user: only the legacy `connections` table
        // exists, with a row in it.
        conn.execute_batch(
            "CREATE TABLE connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT,
                port INTEGER,
                auth_db TEXT,
                username TEXT,
                conn_string TEXT,
                ssh_host TEXT,
                ssh_port INTEGER,
                ssh_user TEXT,
                ssh_key_path TEXT,
                created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO connections (id, name, created_at) VALUES (?1, ?2, ?3)",
            ["legacy-1", "old-conn", "2025-01-01T00:00:00Z"],
        )
        .unwrap();

        run_migrations(&conn).unwrap();

        // Legacy row preserved in the backup table.
        let legacy_name: String = conn
            .query_row(
                "SELECT name FROM connections_v1_backup WHERE id = ?1",
                ["legacy-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(legacy_name, "old-conn");

        // The new `connections` is the v2 schema, empty.
        let v2_cols = column_names(&conn, "connections");
        assert!(v2_cols.iter().any(|c| c == "payload"));
        let v2_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM connections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v2_count, 0);
    }

    #[test]
    fn orphan_legacy_table_is_dropped_when_backup_already_present() {
        let conn = Connection::open_in_memory().unwrap();
        // Boot 1: upgrade path runs to completion.
        conn.execute_batch(
            "CREATE TABLE connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT, created_at TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO connections (id, name, created_at) VALUES (?1, ?2, ?3)",
            ["legacy-1", "old", "x"],
        )
        .unwrap();
        run_migrations(&conn).unwrap();

        // Simulate an inconsistent state: legacy `connections` re-created
        // (e.g. an outside tool restored the table from a backup snapshot)
        // alongside the existing backup.
        conn.execute("DROP TABLE connections", []).unwrap();
        conn.execute_batch(
            "CREATE TABLE connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT, created_at TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO connections (id, name, created_at) VALUES (?1, ?2, ?3)",
            ["zombie", "z", "x"],
        )
        .unwrap();
        // Boot 2: migrations must drop the zombie and re-create v2 `connections`.
        run_migrations(&conn).unwrap();

        // The original legacy row is still safe in the backup.
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM connections_v1_backup", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        // `connections` is again the v2 shape (empty — zombie row is discarded).
        let cols = column_names(&conn, "connections");
        assert!(cols.iter().any(|c| c == "payload"));
        let conn_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM connections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(conn_count, 0);
    }
}
