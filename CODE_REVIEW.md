# Code Review — connection-fallbacks (2e86fbc..22496ea)

Reviewer: `reviewer-mongo`
Iteration: 1

## Stage 1 — Spec Compliance

Plan: `docs/superpowers/plans/2026-05-12-connection-fallbacks.md`.

| Task | Status | Notes |
|------|--------|-------|
| 1 — Move `mongo.rs` → `mongo/mod.rs` | ✅ | `git mv` preserved, compiles. |
| 2 — `ConnectFallback` trait + empty registry | ✅ | Trait shape matches plan exactly. (Registry is non-empty in HEAD because later tasks register strategies — expected.) |
| 3 — `DirectReadPrefFallback` | ✅ | 6 tests (plan said "5" in prose, 6 in the code block — coder kept 6, which is the right count). Implementation matches. |
| 4 — `TlsFallback` | ✅ | 5 tests, matches plan. |
| 5 — `connect_with_fallback` helper | ✅ | Loop, idempotent strategy application, error preservation all match plan. |
| 6 — Route `client_for`/`ping` through helper | ✅ | Duplicate admin ping in `commands/connection.rs` correctly removed. |
| 7 — `is_unauthorized` + `default_db` + `list_databases` fallback | ⚠️ | `default_db` URI parsing has a latent bug — see Stage-2 finding #1. Wiring is otherwise correct. |

**Coder's reported deviations — all justified:**
1. `MongoError::custom` doesn't exist in mongodb 3.5.2 → `make_err` via `io::Error`. Plan explicitly authorised this. ✅
2. Test count 5 vs 6 in Task 3 — coder kept 6 (the code block, not the prose). Consistent. ✅
3. `cargo test --lib mongo` not workable for binary crate → used `cargo test mongo::`. All 21 tests pass. ✅
4. Pre-existing keychain test failures untouched — out of scope. ✅

**Stage 1 verdict:** passes structurally. The default_db bug below is a Stage-2 finding rather than a missing-from-spec issue (the plan's `default_db` code has the same bug — coder copied it verbatim).

---

## Stage 2 — Code Quality (`/code-review:code-review` + `/code-standards` lens)

### Findings

#### 1. 🔴 BLOCKER — `default_db` returns host as database for URIs without explicit path

`src-tauri/src/mongo/mod.rs:55-65`. The function does `cs.rfind('/')` and takes everything after. For URIs without a path segment, that `/` is the second slash of `://`, so the host becomes the "default DB".

Verified by direct trace:

| Input URI | What `default_db` returns |
|-----------|---------------------------|
| `mongodb+srv://cluster.foo` | `Some("cluster.foo")` ❌ |
| `mongodb://h:27017` | `Some("h:27017")` ❌ |
| `mongodb+srv://u:pw@host.mongodb.net/?retryWrites=true` | `None` ✅ (only because of trailing `/`) |
| `mongodb://u:p@h:1/marketplace?authSource=admin` | `Some("marketplace")` ✅ |

This is directly in scope: the feature exists for restricted users on managed clusters, whose URIs typically look like `mongodb+srv://user:pw@cluster.mongodb.net/?…` or `mongodb+srv://cluster.mongodb.net`. If the trailing `/` is absent, the sidebar will show `cluster.mongodb.net` as a "database," the user will click it, and `listCollections` will fail confusingly.

**Required fix:** parse only the path component. Skip past `://` first, then look for the first `/` *after* the host segment. Suggested:

```rust
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
```

Add tests covering:
- `mongodb+srv://cluster.foo` → `None` (falls through to `auth_db`)
- `mongodb://h:27017` → `None`
- `mongodb+srv://user:pw@cluster.mongodb.net/?retryWrites=true` → `None`
- `mongodb://h/marketplace` → `Some("marketplace")` (no query string)

#### 2. 🟡 MINOR — Match-string for `TlsFallback` may be slightly too broad

`strategies.rs:46-52`. `"connection closed"` is a substring of many non-TLS errors (server kicked us, network blip, idle-timeout). Applying TLS in those cases is harmless when the server already speaks TLS, but it adds one wasted retry on plain-TCP outages.

Not blocking — the apply is idempotent and the retry budget is bounded by `registry().len()` — but flag for a future tightening: prefer `("tls" | "ssl" | "handshake")` first and only treat "connection closed" as a hint when combined with one of those. Could note in a `// TODO` rather than fixing now.

#### 3. 🟡 MINOR — `use` statements mid-file in `fallback.rs`

`fallback.rs:26-28` places `use crate::logctx;` / `use crate::logger::Logger;` / `use mongodb::Client;` *between* the trait+registry block and the helper. Style-wise, all `use` lines belong at the top of the file. Moving them up is a 30-second cleanup.

#### 4. 🟢 PASS — Idempotency / loop termination

`connect_with_fallback`:
- `applied: Vec<&'static str>` is checked via `.contains(&s.id())` before each apply.
- Outer loop bound: `for attempt in 0..=registry().len()` → at most `N+1` iterations.
- `find(...)` returns `None` once every matching strategy is already applied → `break`.
- The `last_err.as_ref().unwrap()` on line 79 is sound: when the ping branch succeeds we `return Ok(client)`, so `last_err` is always `Some(_)` if execution reaches the `find`.

#### 5. 🟢 PASS — Error preservation

Returns the *latest* error string, not the first. This is the right call: the final attempt's error is the one the user must act on (e.g., "still TLS-failing after applying TLS" is more actionable than the bare "connection closed" that started the chain).

#### 6. 🟢 PASS — Match string scoping for `DirectReadPrefFallback`

Mental run-through against the canonical error texts from the original session:
- `not primary and secondaryOk=false` → matches ("not primary") ✅
- `Server selection timeout: No available servers` → matches ("server selection") ✅
- `TLS handshake failed` → does **not** match DirectReadPref (good — goes to TLS strategy) ✅
- `connection closed unexpectedly` → does **not** match DirectReadPref ✅
- `not authorized on marketplace to execute command listCollections` → does **not** match any connect strategy ✅
- `authentication failed: ...` → does **not** match ✅

All six canonical strings route correctly.

#### 7. 🟢 PASS — `is_unauthorized` distinguishes code 13

`authz.rs:5-17` checks `ErrorKind::Command { code == 13 }` or `code_name == "Unauthorized"` first; string fallback only fires on transport-wrapped variants. A code-13 Command is the only Command variant that returns `true`. Other codes (auth-failure 18, etc.) do not. ✅

#### 8. 🟢 PASS — `list_databases` fallback path

`commands/collection.rs:43-62`:
- Non-Unauthorized errors propagated via `Err(e.to_string())` — original behaviour preserved. ✅
- Unauthorized → looks up the record via `state.open_db()` + `connections::get` and reads `default_db(&rec)`. ✅
- Returns `vec![]` if no default DB knowable — empty sidebar is correct degraded state. ✅

#### 9. 🟢 PASS — Logging redaction

The pre-refactor file had a comment "uri is redacted automatically by the logger's redact_ctx"; the redactor is keyed on field name (`"uri"`, `"mongoUri"`, `"connectionString"` — see `logger/redact.rs:6`). All new code uses `logctx! { "uri" => uri }` so the URI string is redacted before write. No raw credentials are logged. ✅ (The redact comment did not survive the refactor — not required, but a one-liner reminder above `ping`/`client_for` would be nice future-proofing.)

#### 10. 🟢 PASS — Extensibility per project CLAUDE.md

Adding a new fallback requires:
1. New struct in `strategies.rs` (or its own file) implementing `ConnectFallback`.
2. One line in `fallback::registry()`'s static slice.

No changes to `connect_with_fallback`, no changes to callers. Matches the "extension contract" expected by global CLAUDE.md and the plan's stated architecture. ✅

---

## Required changes (revision 1)

1. **Fix `default_db` URI parsing** so it does not return the host segment for URIs without an explicit path. Implementation sketch + tests above (finding #1).
2. *(Nice to have, not blocking)* — move the three `use` lines at `fallback.rs:26-28` to the top of the file.

Items #2 and #9-second-half from the findings list are nits and can ship as-is if you'd rather not churn — I'll re-approve once #1 is fixed.

---

STATUS: NEEDS_REVISION
