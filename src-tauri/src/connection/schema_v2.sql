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
-- so downstream sync hooks can detect drift.
--
-- The table is named `connections` — the canonical name as of PR 5. The
-- file name (`schema_v2.sql`) is kept for git history continuity; the
-- prior `connections_v2` table name lives on only as an artifact of the
-- one-shot rename migration in `db/migrate.rs`. Index names retain the
-- `_v2` suffix for the same reason — they're cosmetic identifiers, the
-- columns they cover are what matters.

CREATE TABLE IF NOT EXISTS connections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connections_v2_name ON connections(name);
CREATE INDEX IF NOT EXISTS idx_connections_v2_updated_at ON connections(updated_at);
