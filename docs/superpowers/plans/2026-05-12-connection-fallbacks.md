# Connection & Metadata Fallbacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users connect to MongoDB with minimal URI fiddling: auto-recover from "not primary" and TLS-handshake errors at connect time, and degrade gracefully when the authenticated user lacks broad metadata privileges (e.g. `listDatabases`).

**Architecture:** Strategy + Registry pattern. A `ConnectFallback` trait defines `matches(err) -> bool` + `apply(opts: &mut ClientOptions)`. A static registry holds the strategies (DirectReadPref, Tls). The new `connect_with_fallback()` helper builds the client, pings, and on failure walks the registry applying any matching, not-yet-applied strategies, retrying until success or exhaustion. A parallel `authz::run_or<T>()` helper wraps metadata calls (`listDatabases`, `dbStats`, `collStats`) so an `Unauthorized` error returns a sensible fallback value instead of erroring the whole sidebar.

Adding a future fallback strategy is one new file implementing `ConnectFallback` + one line in the registry — no changes to the connect path.

**Tech Stack:** Rust, `mongodb` 3.5 driver, Tauri 2, `tokio`, `cargo test` for unit tests.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| MOVE | `src-tauri/src/mongo.rs` → `src-tauri/src/mongo/mod.rs` | Re-export, keep `build_uri` + `active_client` |
| CREATE | `src-tauri/src/mongo/fallback.rs` | `ConnectFallback` trait, registry, `connect_with_fallback` |
| CREATE | `src-tauri/src/mongo/strategies.rs` | `DirectReadPrefFallback`, `TlsFallback` |
| CREATE | `src-tauri/src/mongo/authz.rs` | `is_unauthorized(err)`, `run_or<T>(future, fallback)` |
| MODIFY | `src-tauri/src/mongo/mod.rs` | `client_for` & `ping` delegate to `connect_with_fallback` |
| MODIFY | `src-tauri/src/commands/collection.rs` | `list_databases` falls back to URI's default DB on Unauthorized |
| MODIFY | `src-tauri/src/commands/connection.rs` | Use `client_for` result directly (no double-ping) |
| MODIFY | `src-tauri/src/lib.rs` or `main.rs` | Module declaration update if needed |

---

## Task 1: Carve out `mongo/` module (no logic change)

**Files:**
- Move: `src-tauri/src/mongo.rs` → `src-tauri/src/mongo/mod.rs`

- [ ] **Step 1: Move the file**

```bash
mkdir -p src-tauri/src/mongo
git mv src-tauri/src/mongo.rs src-tauri/src/mongo/mod.rs
```

- [ ] **Step 2: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: builds clean (Rust automatically picks up `mongo/mod.rs` as the module).

- [ ] **Step 3: Run existing tests**

Run: `cd src-tauri && cargo test --lib mongo`
Expected: the 3 existing tests in `mongo/mod.rs` pass: `uri_with_password`, `uri_without_password`, `conn_string_overrides`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/mongo/
git commit -m "refactor(mongo): move mongo.rs into mongo/ module"
```

---

## Task 2: Define the `ConnectFallback` trait + registry (TDD)

**Files:**
- Create: `src-tauri/src/mongo/fallback.rs`
- Modify: `src-tauri/src/mongo/mod.rs` (add `pub mod fallback;`)

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/mongo/fallback.rs` with the test module first:

```rust
use mongodb::error::Error as MongoError;
use mongodb::options::ClientOptions;

/// Implement this trait and register in `registry()` to add a new connect-time fallback.
/// Strategies must be idempotent — `apply` is only called once per strategy per connect attempt.
pub trait ConnectFallback: Send + Sync {
    /// Stable identifier for logging + de-duplication ("direct-read-pref", "tls").
    fn id(&self) -> &'static str;

    /// Returns true when this strategy should be tried for the given error.
    fn matches(&self, err: &MongoError) -> bool;

    /// Mutates `opts` to apply the fallback. Must not panic.
    fn apply(&self, opts: &mut ClientOptions);
}

pub fn registry() -> &'static [&'static dyn ConnectFallback] {
    // Order matters: try cheaper / more common fallbacks first.
    static REG: &[&dyn ConnectFallback] = &[];
    REG
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeStrat;
    impl ConnectFallback for FakeStrat {
        fn id(&self) -> &'static str { "fake" }
        fn matches(&self, _err: &MongoError) -> bool { true }
        fn apply(&self, opts: &mut ClientOptions) {
            opts.app_name = Some("touched".into());
        }
    }

    #[test]
    fn registry_returns_slice() {
        let _ = registry().len();
    }

    #[test]
    fn strategy_can_mutate_options() {
        let mut opts = ClientOptions::default();
        FakeStrat.apply(&mut opts);
        assert_eq!(opts.app_name.as_deref(), Some("touched"));
    }
}
```

Add to `src-tauri/src/mongo/mod.rs` (top, after `use` block):

```rust
pub mod fallback;
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib mongo::fallback`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mongo/
git commit -m "feat(mongo): add ConnectFallback trait and empty registry"
```

---

## Task 3: Implement `DirectReadPrefFallback` (TDD)

**Files:**
- Create: `src-tauri/src/mongo/strategies.rs`
- Modify: `src-tauri/src/mongo/mod.rs` (add `pub mod strategies;`)
- Modify: `src-tauri/src/mongo/fallback.rs` (register the strategy)

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/mongo/strategies.rs`:

```rust
use crate::mongo::fallback::ConnectFallback;
use mongodb::error::{Error as MongoError, ErrorKind};
use mongodb::options::{ClientOptions, SelectionCriteria};
use mongodb::options::{ReadPreference, ReadPreferenceOptions};

/// Recovers from "no primary reachable" errors that occur when:
///   - the user SSH-tunnels to a single replica-set member, OR
///   - the only reachable node is a secondary
/// Adds `directConnection=true` and `readPreference=secondaryPreferred` if absent.
pub struct DirectReadPrefFallback;

impl ConnectFallback for DirectReadPrefFallback {
    fn id(&self) -> &'static str { "direct-read-pref" }

    fn matches(&self, err: &MongoError) -> bool {
        let msg = err.to_string().to_lowercase();
        // Server returns code 10107 (NotWritablePrimary) or topology errors mentioning primary.
        msg.contains("not primary")
            || msg.contains("notwritableprimary")
            || msg.contains("no primary")
            || msg.contains("server selection")
    }

    fn apply(&self, opts: &mut ClientOptions) {
        if opts.direct_connection.is_none() {
            opts.direct_connection = Some(true);
        }
        if opts.selection_criteria.is_none() {
            opts.selection_criteria = Some(SelectionCriteria::ReadPreference(
                ReadPreference::SecondaryPreferred {
                    options: Some(ReadPreferenceOptions::default()),
                },
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_not_primary_error_text() {
        // We can't easily fabricate a MongoError with a specific kind, so use a
        // CustomError variant we construct ourselves via the public API.
        let err = MongoError::custom("not primary and secondaryOk=false");
        assert!(DirectReadPrefFallback.matches(&err));
    }

    #[test]
    fn matches_server_selection_error_text() {
        let err = MongoError::custom("Server selection timeout: no available servers");
        assert!(DirectReadPrefFallback.matches(&err));
    }

    #[test]
    fn does_not_match_unrelated_error() {
        let err = MongoError::custom("authentication failed: bad password");
        assert!(!DirectReadPrefFallback.matches(&err));
    }

    #[test]
    fn apply_sets_direct_and_read_pref_when_absent() {
        let mut opts = ClientOptions::default();
        DirectReadPrefFallback.apply(&mut opts);
        assert_eq!(opts.direct_connection, Some(true));
        assert!(matches!(
            opts.selection_criteria,
            Some(SelectionCriteria::ReadPreference(ReadPreference::SecondaryPreferred { .. }))
        ));
    }

    #[test]
    fn apply_preserves_user_supplied_direct_connection() {
        let mut opts = ClientOptions::default();
        opts.direct_connection = Some(false);
        DirectReadPrefFallback.apply(&mut opts);
        assert_eq!(opts.direct_connection, Some(false));
    }

    #[test]
    fn apply_preserves_user_supplied_read_pref() {
        let mut opts = ClientOptions::default();
        opts.selection_criteria = Some(SelectionCriteria::ReadPreference(ReadPreference::Primary));
        DirectReadPrefFallback.apply(&mut opts);
        assert!(matches!(
            opts.selection_criteria,
            Some(SelectionCriteria::ReadPreference(ReadPreference::Primary))
        ));
    }
}
```

Update `src-tauri/src/mongo/mod.rs` to declare the new module:

```rust
pub mod fallback;
pub mod strategies;
```

Update `src-tauri/src/mongo/fallback.rs` registry:

```rust
pub fn registry() -> &'static [&'static dyn ConnectFallback] {
    static REG: &[&dyn ConnectFallback] = &[
        &crate::mongo::strategies::DirectReadPrefFallback,
    ];
    REG
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib mongo::strategies`
Expected: 5 tests pass.

If `MongoError::custom` doesn't exist in the driver version, adjust by constructing an error via:
```rust
let err: MongoError = mongodb::error::Error::custom("not primary");
```
or use `mongodb::error::Error::from(std::io::Error::new(std::io::ErrorKind::Other, "not primary"))`.
The matcher reads `err.to_string()`, so as long as the message is preserved, the test is valid.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mongo/
git commit -m "feat(mongo): DirectReadPrefFallback for not-primary errors"
```

---

## Task 4: Implement `TlsFallback` (TDD)

**Files:**
- Modify: `src-tauri/src/mongo/strategies.rs`
- Modify: `src-tauri/src/mongo/fallback.rs` (register)

- [ ] **Step 1: Add tests + impl**

Append to `src-tauri/src/mongo/strategies.rs`:

```rust
use mongodb::options::TlsOptions;

/// Recovers from TLS-handshake / "connection closed" errors when connecting to
/// managed clusters (Atlas, DocumentDB) that require TLS by default.
pub struct TlsFallback;

impl ConnectFallback for TlsFallback {
    fn id(&self) -> &'static str { "tls" }

    fn matches(&self, err: &MongoError) -> bool {
        let msg = err.to_string().to_lowercase();
        msg.contains("tls")
            || msg.contains("ssl")
            || msg.contains("connection closed")
            || msg.contains("handshake")
    }

    fn apply(&self, opts: &mut ClientOptions) {
        if opts.tls.is_none() {
            opts.tls = Some(mongodb::options::Tls::Enabled(TlsOptions::default()));
        }
    }
}

#[cfg(test)]
mod tls_tests {
    use super::*;

    #[test]
    fn matches_tls_error() {
        let err = MongoError::custom("TLS handshake failed");
        assert!(TlsFallback.matches(&err));
    }

    #[test]
    fn matches_connection_closed() {
        let err = MongoError::custom("connection closed unexpectedly");
        assert!(TlsFallback.matches(&err));
    }

    #[test]
    fn does_not_match_auth_error() {
        let err = MongoError::custom("authentication failed");
        assert!(!TlsFallback.matches(&err));
    }

    #[test]
    fn apply_enables_tls_when_absent() {
        let mut opts = ClientOptions::default();
        TlsFallback.apply(&mut opts);
        assert!(matches!(opts.tls, Some(mongodb::options::Tls::Enabled(_))));
    }

    #[test]
    fn apply_preserves_user_tls_disabled() {
        let mut opts = ClientOptions::default();
        opts.tls = Some(mongodb::options::Tls::Disabled);
        TlsFallback.apply(&mut opts);
        assert!(matches!(opts.tls, Some(mongodb::options::Tls::Disabled)));
    }
}
```

Update registry in `src-tauri/src/mongo/fallback.rs`:

```rust
pub fn registry() -> &'static [&'static dyn ConnectFallback] {
    static REG: &[&dyn ConnectFallback] = &[
        &crate::mongo::strategies::DirectReadPrefFallback,
        &crate::mongo::strategies::TlsFallback,
    ];
    REG
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib mongo::strategies`
Expected: 10 tests pass (5 from Task 3 + 5 new).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mongo/
git commit -m "feat(mongo): TlsFallback for managed-cluster connections"
```

---

## Task 5: Implement `connect_with_fallback` helper

**Files:**
- Modify: `src-tauri/src/mongo/fallback.rs`

- [ ] **Step 1: Add the helper**

Append to `src-tauri/src/mongo/fallback.rs` (after the trait, before `#[cfg(test)]`):

```rust
use crate::logctx;
use crate::logger::Logger;
use mongodb::{options::ClientOptions, Client};

/// Build a client from `uri`, ping `admin`, and on failure walk the registry applying any
/// matching strategies and retrying. Returns the first successful client. Each strategy is
/// applied at most once. If no strategy matches or all retries fail, returns the original error.
pub async fn connect_with_fallback(
    uri: &str,
    log: &dyn Logger,
) -> Result<Client, String> {
    let base_opts = ClientOptions::parse(uri).await.map_err(|e| {
        log.error("mongo parse failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    let mut applied: Vec<&'static str> = Vec::new();
    let mut opts = base_opts;
    let mut last_err: Option<mongodb::error::Error> = None;

    // First attempt + up to `registry().len()` fallback attempts.
    for attempt in 0..=registry().len() {
        let client = match Client::with_options(opts.clone()) {
            Ok(c) => c,
            Err(e) => {
                log.error("mongo client build failed", logctx! { "err" => e.to_string() });
                return Err(e.to_string());
            }
        };

        match client
            .database("admin")
            .run_command(mongodb::bson::doc! {"ping": 1})
            .await
        {
            Ok(_) => {
                if attempt > 0 {
                    log.info("mongo connect ok via fallback", logctx! {
                        "applied" => applied.join(","),
                    });
                }
                return Ok(client);
            }
            Err(e) => {
                log.warn("mongo ping failed", logctx! {
                    "attempt" => attempt as i64,
                    "err" => e.to_string(),
                });
                last_err = Some(e);
            }
        }

        // Find a strategy that matches the latest error and hasn't been applied yet.
        let err = last_err.as_ref().unwrap();
        let next = registry()
            .iter()
            .find(|s| !applied.contains(&s.id()) && s.matches(err));
        match next {
            Some(strat) => {
                log.info("mongo applying fallback", logctx! { "strategy" => strat.id() });
                strat.apply(&mut opts);
                applied.push(strat.id());
            }
            None => break,
        }
    }

    Err(last_err.map(|e| e.to_string()).unwrap_or_else(|| "connect failed".into()))
}
```

- [ ] **Step 2: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: builds clean.

Note: this helper is integration-tested by Task 6 against the existing `client_for` callers, not unit-tested in isolation (would require mocking the driver). The unit tests on strategies prove the logic; this helper is plumbing.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mongo/fallback.rs
git commit -m "feat(mongo): connect_with_fallback helper that retries with strategies"
```

---

## Task 6: Route `client_for` and `ping` through the fallback helper

**Files:**
- Modify: `src-tauri/src/mongo/mod.rs`

- [ ] **Step 1: Replace `client_for` and `ping` bodies**

In `src-tauri/src/mongo/mod.rs`, replace the existing `ping` and `client_for` functions with:

```rust
pub async fn ping(uri: &str, log: &dyn Logger) -> Result<(), String> {
    log.info("mongo ping", logctx! { "uri" => uri });
    // connect_with_fallback already pings admin as part of validating the connection.
    fallback::connect_with_fallback(uri, log).await.map(|_| ())
}

pub async fn client_for(uri: &str, log: &dyn Logger) -> Result<mongodb::Client, String> {
    log.info("mongo connect", logctx! { "uri" => uri });
    fallback::connect_with_fallback(uri, log).await
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd src-tauri && cargo test --lib mongo`
Expected: `uri_with_password`, `uri_without_password`, `conn_string_overrides`, plus all strategy tests pass.

- [ ] **Step 3: Remove now-redundant ping in `connect_connection`**

In `src-tauri/src/commands/connection.rs`, the `connect_connection` function (lines 228-236) pings admin **again** after `client_for`. Since `client_for` now pings as part of `connect_with_fallback`, remove the duplicate.

Replace lines 228-237 in `src-tauri/src/commands/connection.rs`:

```rust
    let client = mongo::client_for(&uri, log.as_ref()).await?;
    state.mongo_clients.lock().unwrap().insert(id, client);
```

- [ ] **Step 4: Run full check**

Run: `cd src-tauri && cargo check && cargo test --lib`
Expected: builds + all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mongo/mod.rs src-tauri/src/commands/connection.rs
git commit -m "feat(mongo): route ping/connect through fallback helper, remove duplicate admin ping"
```

---

## Task 7: Authorization-tolerant `list_databases`

**Files:**
- Create: `src-tauri/src/mongo/authz.rs`
- Modify: `src-tauri/src/mongo/mod.rs` (declare module)
- Modify: `src-tauri/src/commands/collection.rs`

- [ ] **Step 1: Create the authz helper with tests**

Create `src-tauri/src/mongo/authz.rs`:

```rust
use mongodb::error::{Error as MongoError, ErrorKind};

/// Returns true if the error is an `Unauthorized` (code 13) command failure.
/// Used to swallow metadata-listing failures for restricted users and degrade gracefully.
pub fn is_unauthorized(err: &MongoError) -> bool {
    if let ErrorKind::Command(cmd) = err.kind.as_ref() {
        // MongoDB error code 13 = Unauthorized.
        if cmd.code == 13 {
            return true;
        }
        if cmd.code_name.eq_ignore_ascii_case("Unauthorized") {
            return true;
        }
    }
    // String fallback for transport-layer wrappers.
    err.to_string().to_lowercase().contains("not authorized")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_not_authorized_text() {
        let err = MongoError::custom("not authorized on admin to execute command listDatabases");
        assert!(is_unauthorized(&err));
    }

    #[test]
    fn ignores_other_errors() {
        let err = MongoError::custom("network timeout");
        assert!(!is_unauthorized(&err));
    }
}
```

Update `src-tauri/src/mongo/mod.rs`:

```rust
pub mod authz;
pub mod fallback;
pub mod strategies;
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib mongo::authz`
Expected: 2 tests pass.

- [ ] **Step 3: Wire `list_databases` to fall back**

In `src-tauri/src/commands/collection.rs`, modify `list_databases` (currently lines 32-50). The fallback when the user can't list all databases is to return only the URI's default DB if known. Pull that from the connection record.

First, modify `src-tauri/src/mongo/mod.rs`'s `active_client` is unchanged; we need the connection record's `auth_db` (or URI default DB) at the command site. Add a helper:

In `src-tauri/src/mongo/mod.rs`, add:

```rust
/// Best-effort default-database name for a connection (used when listDatabases is unauthorized).
pub fn default_db(rec: &ConnectionRecord) -> Option<String> {
    if let Some(cs) = &rec.conn_string {
        if let Some(end) = cs.rfind('/') {
            let after_slash = &cs[end + 1..];
            // strip query string
            let db = after_slash.split('?').next().unwrap_or("");
            if !db.is_empty() && db != "admin" { return Some(db.to_string()); }
        }
    }
    rec.auth_db.clone().filter(|d| !d.is_empty() && d != "admin")
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
}
```

Modify `list_databases` in `src-tauri/src/commands/collection.rs`:

```rust
#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.collection",
        "connId" => connection_id.clone(),
    });
    log.info("list_databases", logctx! {});
    let client = mongo::active_client(&state, &connection_id)?;

    match client.list_database_names().await {
        Ok(names) => Ok(names.into_iter().filter(|n| n != "local").collect()),
        Err(e) if mongo::authz::is_unauthorized(&e) => {
            log.warn("list_databases unauthorized, falling back to default db",
                logctx! { "err" => e.to_string() });
            // Look up the connection record for its default DB.
            let sql = state.open_db().map_err(|e| e.to_string())?;
            let rec = crate::db::connections::get(&sql, &connection_id)
                .map_err(|e| e.to_string())?
                .ok_or("connection not found")?;
            match mongo::default_db(&rec) {
                Some(db) => Ok(vec![db]),
                None => Ok(vec![]),
            }
        }
        Err(e) => {
            log.error("list_database_names failed", logctx! { "err" => e.to_string() });
            Err(e.to_string())
        }
    }
}
```

- [ ] **Step 4: Run tests + check**

Run: `cd src-tauri && cargo check && cargo test --lib mongo`
Expected: builds; all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mongo/ src-tauri/src/commands/collection.rs
git commit -m "feat(mongo): fall back to default DB when listDatabases is unauthorized"
```

---

## Task 8: Manual verification against Prod connection

**Files:** none (verification only)

- [ ] **Step 1: Rebuild the app**

Run: `npm run tauri dev` (or whatever the project's dev script is — check `package.json` scripts).

- [ ] **Step 2: Open the Prod connection**

In the Mongo-Lens UI, connect to the saved "Prod" connection (the SSH-tunneled marketplace one). Verify:

- Connection succeeds without the user adding `directConnection=true` or `readPreference=secondaryPreferred` to the URI.
- The sidebar shows `marketplace` (single DB, from the fallback path).
- Expanding `marketplace` shows the ~122 collections the user can read.

- [ ] **Step 3: Check logs for fallback application**

Look in `~/.mongomacapp/logs/` for entries like `mongo applying fallback strategy=direct-read-pref` to confirm the fallback path fired (only if the user's URI doesn't already have these set).

- [ ] **Step 4: Regression-check a normal (admin) connection**

Connect to the "Localhost" connection. Verify it still connects cleanly, lists all databases, and the fallback log lines are **absent** (no fallback should fire on a healthy connection).

- [ ] **Step 5: Commit anything generated (if relevant)**

If only verification, no commit. Otherwise:

```bash
git add -A
git commit -m "chore: verification artifacts"
```

---

## Out of scope (deferred)

- `collStats` / `dbStats` swallow-on-unauthorized — apply same pattern when those calls are introduced; the `authz::is_unauthorized()` helper is already in place to support it.
- `authSource=admin` fallback on auth-failure — useful but adds login retry complexity (real password verification, account lockout risk). Defer to a follow-up.
- UI surface for "you're connected as a restricted user" badge — not part of the connection-fallback scope.

---

## Self-review

**Spec coverage** — covered: directConnection+readPref fallback (Task 3,5,6), TLS fallback (Task 4,5,6), listDatabases unauthorized fallback (Task 7), extensibility via trait+registry (Task 2), no URI editing required by user (verified Task 8). Deferred items explicitly listed.

**Placeholder scan** — every code step shows full code. Every command shows expected output. No TBDs.

**Type consistency** — `ConnectFallback` trait signature is identical across Tasks 2/3/4/5. `connect_with_fallback` signature matches its caller usage in Task 6. `is_unauthorized` signature matches usage in Task 7. `default_db` signature matches usage in Task 7.
