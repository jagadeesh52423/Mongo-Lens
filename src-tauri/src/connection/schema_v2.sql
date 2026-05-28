-- Schema for the v2 connection store.
--
-- One row per Connection. The full Connection JSON (matching the tagged-union
-- model in src-tauri/src/connection/model.rs and tests/fixtures/connection/*)
-- is stored verbatim in `payload`. `id` and `name` are projected out as
-- dedicated columns so list queries can sort/filter cheaply without parsing
-- every payload.
--
-- `created_at` mirrors the value embedded in the payload at first insert
-- (preserved on update). `updated_at` is set by the store on every write
-- so the migration runner (Task 11) and any sync hooks can detect drift.
--
-- The old flat `connections` table is intentionally NOT touched here —
-- it's owned by db/migrate.rs and continues to exist alongside this table
-- until Phase 2 cuts over.

CREATE TABLE IF NOT EXISTS connections_v2 (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connections_v2_name ON connections_v2(name);
CREATE INDEX IF NOT EXISTS idx_connections_v2_updated_at ON connections_v2(updated_at);
