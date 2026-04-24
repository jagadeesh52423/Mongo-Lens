# File-Based Logging + Dependency Injection — Design Spec

**Date:** 2026-04-24
**Status:** Approved

## Overview

Introduce structured file-based logging across all three layers of MongoMacApp (React frontend, Rust/Tauri backend, Node runner) with lightweight constructor-based dependency injection for the `Logger`. The design emphasises a tiny port interface per layer, pluggable adapters (swap in `MemoryLogger` for tests, add a remote sink later without touching callers), and a single correlation id (`runId`) threaded across layers so the full causal chain of a production incident can be reconstructed by grepping one id.

**Primary goal:** Diagnose production issues. When a user reports a bug, the relevant log files under `~/.mongomacapp/logs/` should be sufficient to understand what happened across frontend, backend, and runner.

**DI scope:** Logger only. Services accept `Logger` through their constructor (or as the first function argument). No DI framework — plain constructor injection + a composition root per process entry point. Proves the pattern on one cross-cutting dependency without refactoring everything.

**Non-goals (YAGNI):**
- No in-app log viewer UI (the port makes it easy to add later).
- No remote log shipping.
- No per-logger level configuration (one global level per process).
- No migration to a DI container (InversifyJS / tsyringe / etc.).

---

## Architecture

### Three layers, one port per layer

Each layer owns a small `Logger` port. Implementations (adapters) are wired exactly once at the composition root. Consumers depend only on the interface.

**Supported levels:** `ERROR | WARN | INFO | DEBUG` (`TRACE` intentionally excluded — `DEBUG` covers our needs).

#### Frontend — `src/services/logger/`

```ts
// src/services/logger/types.ts
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogCtx = Record<string, unknown>;

export interface LogRecord {
  ts: number;          // epoch ms
  level: LogLevel;
  logger: string;      // dotted module path
  runId?: string;
  msg: string;
  ctx: LogCtx;
}

export interface Logger {
  error(msg: string, ctx?: LogCtx): void;
  warn(msg: string, ctx?: LogCtx): void;
  info(msg: string, ctx?: LogCtx): void;
  debug(msg: string, ctx?: LogCtx): void;
  /** Returns a new Logger whose records merge `bindings` into every ctx. */
  child(bindings: LogCtx): Logger;
}
```

Adapters:

| Adapter | Purpose |
|---|---|
| `IpcLogger` | Production — forwards records to Rust via `invoke('log_write', record)`. Batches records; flushes every 100 ms or when buffer hits 20 records. |
| `ConsoleLogger` | Dev fallback — pretty-prints to browser console. Used when Tauri IPC unavailable (e.g., pure Vite dev server). |
| `NoopLogger` | Tests / early boot before composition root runs. |
| `MemoryLogger` | Tests — exposes `.records: LogRecord[]` for assertions. |

Factory: `src/services/logger/index.ts` exports `createLogger(opts)` which selects the adapter based on environment. To add a new sink, implement `Logger` and add it to the factory — no caller changes.

#### Rust — `src-tauri/src/logger/`

```rust
// src-tauri/src/logger/mod.rs
use std::sync::Arc;
use std::collections::HashMap;
use serde_json::Value;

pub type LogCtx = HashMap<String, Value>;

pub trait Logger: Send + Sync {
    fn log(&self, record: LogRecord);
    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger>;

    fn error(&self, msg: &str, ctx: LogCtx) { self.log(self.make_record(Level::Error, msg, ctx)); }
    fn warn (&self, msg: &str, ctx: LogCtx) { self.log(self.make_record(Level::Warn,  msg, ctx)); }
    fn info (&self, msg: &str, ctx: LogCtx) { self.log(self.make_record(Level::Info,  msg, ctx)); }
    fn debug(&self, msg: &str, ctx: LogCtx) { self.log(self.make_record(Level::Debug, msg, ctx)); }

    fn make_record(&self, level: Level, msg: &str, ctx: LogCtx) -> LogRecord;
}

pub struct LogRecord {
    pub ts: String,
    pub level: Level,
    pub layer: Layer,        // Frontend | Backend | Runner
    pub logger: String,
    pub run_id: Option<String>,
    pub msg: String,
    pub ctx: LogCtx,
}
```

Default impl `TracingLogger` wraps the `tracing` crate + `tracing-appender` rolling-file writer. It owns two appenders internally:

- One for `backend.log` — written by Rust code directly.
- One for `app.log` — written on behalf of frontend records received via the `log_write` IPC command.

`Arc<dyn Logger>` lives in `AppState` (existing struct, add a `logger` field). Commands pull it and derive a child logger per invocation.

New dependencies: `tracing = "0.1"`, `tracing-subscriber = "0.3"`, `tracing-appender = "0.2"`.

#### Node runner — `runner/logger.js`

```js
class Logger {
  constructor(writer, bindings = {}) {
    this.writer = writer;
    this.bindings = bindings;
  }
  error(msg, ctx) { this._write('error', msg, ctx); }
  warn(msg, ctx)  { this._write('warn',  msg, ctx); }
  info(msg, ctx)  { this._write('info',  msg, ctx); }
  debug(msg, ctx) { this._write('debug', msg, ctx); }
  child(bindings) { return new Logger(this.writer, { ...this.bindings, ...bindings }); }
  _write(level, msg, ctx) { /* format + writer.write(line) */ }
}
```

Writers:
- `FileWriter(path)` — opens `~/.mongomacapp/logs/runner-<runId>.log`, appends JSON lines.
- `NullWriter` — drops everything; used in unit tests.

Factory: `createLogger({ runId, logsDir, level })` in `runner/logger.js`.

### Extension contract

The `Logger` port is the extension point for all log sinks. To add a new sink (e.g., in-app log viewer panel, Sentry/remote ingestion, JSONL tail for automated tests):

1. Implement `Logger` (frontend) / `Logger` trait (Rust) / `Logger` class (runner).
2. Register in the layer's factory.
3. No existing code changes — callers depend only on the interface.

---

## Data flow & correlation

### `runId` — the single correlation id

A UUID v4 generated at the origin event. For script execution, the existing `runId` in `EditorArea.executeContent` is reused. For non-script flows (connection open, save-script, etc.), a fresh `runId` is generated at the Tauri command boundary.

### Propagation path — script execution

```
React click in EditorArea
  ├─ runId = uuid()
  ├─ logger.child({ runId, tabId }).info("execute requested", { connId, db, pageSize })
  └─ invoke('run_script', { runId, connId, db, script, page, pageSize, ... })
        │
        ▼  Rust command
  ├─ state.logger.child({ runId, connId }).info("run_script start")
  ├─ redact script → log first 200 chars + sha256
  └─ spawn node runner with env
        MONGOMACAPP_RUN_ID=<runId>
        MONGOMACAPP_LOGS_DIR=<logs dir>
        MONGOMACAPP_LOG_LEVEL=<level>
              │
              ▼  harness.js
        ├─ createLogger({ runId, logsDir, level }) → writes runner-<runId>.log
        ├─ logger.info("harness start", { dbName, scriptPath })
        ├─ logger passed into transformScript, makeCursorProxy, emitGroup
        └─ on exit: logger.info("harness end", { durationMs, groups })
```

### Frontend → backend IPC for `app.log`

Frontend records go through one Tauri command:

```ts
// payload shape
{
  ts: number,          // epoch ms, formatted to ISO8601 by backend
  level: LogLevel,
  logger: string,      // dotted module path, e.g. "components.EditorArea"
  runId?: string,
  msg: string,
  ctx?: LogCtx,
}
```

```rust
#[tauri::command]
fn log_write(record: FrontendLogRecord, state: State<AppState>) {
  state.logger.write_frontend(record);  // appends to app.log appender
}
```

Frontend `IpcLogger` batches records: pushes into an in-memory queue, flushes every 100 ms or when queue hits 20 records. On tab close / page unload, `flush()` is best-effort — records in flight may be lost. Acceptable because frontend errors critical enough to care about will also trigger a backend error via the subsequent failed command.

### Correlation flowing back

The Rust `__debug` / script-event payloads that already reach the frontend (via `useScriptEvents`) are extended with `runId`. The frontend logger's `child({ runId })` binds it automatically so subsequent UI logs keep the chain intact.

---

## File layout & rotation

### Directory

`~/.mongomacapp/logs/` — Rust creates it on startup with `0700` perms.

### Files

| File | Writer | Contents |
|---|---|---|
| `app.log` | Rust (via `log_write` IPC from frontend) | UI events, user-initiated actions, frontend errors |
| `backend.log` | Rust `tracing-appender` | Tauri commands, mongo connect/query lifecycle, keychain ops, runner spawn |
| `runner-<runId>.log` | Node runner | Per-execution script lifecycle (transform, cursor materialize, error traces) |

**Why per-run files for the runner:** each runner invocation is a short-lived process with a bounded lifetime. One file per run lets you share a single file with a collaborator to diagnose a specific execution and matches the correlation model (search by `runId` → one obvious file).

### Rotation

- `app.log` and `backend.log`: rolled daily by `tracing-appender::rolling::daily`. Rolled files named `app.log.YYYY-MM-DD`, `backend.log.YYYY-MM-DD`.
- `runner-<runId>.log`: not rotated — one file per run by definition.

### Retention

On backend startup and once every 24 h while running:

- Delete `app.log.*` older than 7 days.
- Delete `backend.log.*` older than 7 days.
- Delete `runner-*.log` files whose mtime is older than 7 days.

Implemented as `src-tauri/src/logger/retention.rs::sweep(logs_dir)`, invoked from a `tokio::spawn` interval task started in `main.rs`.

### Line format — JSONL (every layer, every file)

```json
{"ts":"2026-04-24T10:30:00.123Z","level":"info","layer":"backend","logger":"commands.script","runId":"8f2c4...","msg":"run_script start","ctx":{"connId":"c_1","db":"app"}}
```

Fields:
- `ts` — ISO 8601 UTC.
- `level` — one of `error | warn | info | debug`.
- `layer` — one of `frontend | backend | runner`.
- `logger` — dotted module path (e.g., `components.EditorArea`, `commands.script`, `harness.transform`).
- `runId` — optional; present when the event is tied to a correlated flow.
- `msg` — free-form human string, short.
- `ctx` — optional object; additional structured fields. `child()` bindings are merged in here.

### Level control

Environment variable `MONGOMACAPP_LOG_LEVEL` read once at startup by each layer's composition root.
- Default in release build: `info`.
- Default in dev build: `debug`.

---

## Dependency injection — composition roots

### Principle

No service imports a concrete logger. Every service accepts a `Logger` through its constructor (or as the first parameter for free functions). Concretes are wired exactly once per process, at the entry point. This is plain constructor injection — the cheapest form of DI, no framework needed.

### Frontend — `src/main.tsx`

```ts
import { createLogger, LoggerProvider } from './services/logger';

const logger = createLogger({
  env: import.meta.env.DEV ? 'dev' : 'prod',
  level: import.meta.env.MONGOMACAPP_LOG_LEVEL ?? (import.meta.env.DEV ? 'debug' : 'info'),
});

ReactDOM.createRoot(el).render(
  <LoggerProvider value={logger}>
    <App />
  </LoggerProvider>
);
```

Consumers:
- React components: `const log = useLogger('EditorArea')` — returns `logger.child({ logger: 'components.EditorArea' })`.
- Non-React services (`KeyboardService`, `ai/*`): constructor accepts `logger: Logger`. Existing instantiation sites in `App.tsx` pass it in.

### Rust — `src-tauri/src/main.rs`

```rust
let logs_dir = home_dir().join(".mongomacapp/logs");
std::fs::create_dir_all(&logs_dir)?;
let logger: Arc<dyn Logger> = Arc::new(TracingLogger::init(&logs_dir, level)?);

// Existing AppState gains a `logger` field.
let app_state = AppState {
    logger: logger.clone(),
    // ... existing fields
};

// Retention sweep every 24h
{
    let dir = logs_dir.clone();
    tokio::spawn(async move {
        loop {
            logger::retention::sweep(&dir);
            tokio::time::sleep(std::time::Duration::from_secs(86_400)).await;
        }
    });
}

tauri::Builder::default()
    .manage(app_state)
    .invoke_handler(tauri::generate_handler![
        /* existing + log_write */
    ])
    .run(ctx)?;
```

Commands pull the logger out of `State<AppState>`:

```rust
#[tauri::command]
async fn run_script(run_id: String, /* ... */, state: State<'_, AppState>) -> Result<..., ...> {
    let mut bindings = LogCtx::new();
    bindings.insert("runId".into(), json!(run_id));
    bindings.insert("connId".into(), json!(conn_id));
    let log = state.logger.child(bindings);
    log.info("run_script start", LogCtx::new());
    // ...
}
```

`runner::executor::spawn` is updated to accept `logger: &dyn Logger` and pass env vars into the child process.

### Node runner — `runner/harness.js`

```js
const { createLogger } = require('./logger');

const logger = createLogger({
  runId: process.env.MONGOMACAPP_RUN_ID,
  logsDir: process.env.MONGOMACAPP_LOGS_DIR,
  level: process.env.MONGOMACAPP_LOG_LEVEL || 'info',
});

logger.info('harness start', { dbName, scriptPath });

// every helper takes `logger` as a parameter
transformScript(rawScript, logger);
const cursorProxy = makeCursorProxy(cursor, countPromise, logger.child({ logger: 'harness.cursor' }));
```

---

## Refactor footprint

### New files

**Frontend (`src/services/logger/`)**
- `types.ts` — `LogLevel`, `LogCtx`, `Logger`, `LogRecord`.
- `index.ts` — `createLogger`, `LoggerProvider`, `useLogger`.
- `IpcLogger.ts`
- `ConsoleLogger.ts`
- `NoopLogger.ts`
- `MemoryLogger.ts`
- `redact.ts` — `redactCtx(ctx)` — replaces sensitive fields (see "Log content safety").

**Rust (`src-tauri/src/logger/`)**
- `mod.rs` — `Logger` trait, `LogRecord`, `Level`, `Layer`.
- `tracing.rs` — `TracingLogger` implementation + `init()`.
- `retention.rs` — `sweep(logs_dir)`.
- `redact.rs` — redaction helpers.
- Add `log_write` command in `src-tauri/src/commands/logging.rs` (new file).

**Runner (`runner/`)**
- `logger.js` — `Logger` class + `createLogger` factory + `FileWriter` + `NullWriter`.
- `redact.js` — redaction helpers.
- `__tests__/logger.test.js`

### Edited files

| File | Change |
|---|---|
| `src/main.tsx` | Create root logger; wrap App in `LoggerProvider`. |
| `src/App.tsx` | Replace 3 `console.log` with `logger.info/debug`. Pass logger into `KeyboardService` constructor. |
| `src/components/editor/EditorArea.tsx` | Replace `console.log` on line 68 with `useLogger` + `log.debug`. |
| `src/hooks/useScriptEvents.ts` | Replace `console.log` with `useLogger` + `log.debug`. Extract `runId` from event payload and pass into logger via `child`. |
| `src/services/KeyboardService.ts` | Accept `logger: Logger` in constructor. |
| `src/services/ai/*` | Accept `logger: Logger` where services are instantiated. |
| `src-tauri/src/main.rs` | Init `TracingLogger`, add to `AppState`, spawn retention task, register `log_write` handler. |
| `src-tauri/src/state.rs` | Add `logger: Arc<dyn Logger>` field to `AppState`. |
| `src-tauri/src/commands/script.rs` | Log run_script lifecycle; accept `runId` from frontend; pass logger to `runner::executor::spawn`. |
| `src-tauri/src/commands/connection.rs` | Log connect / disconnect / list ops. |
| `src-tauri/src/commands/collection.rs`, `document.rs`, `saved_script.rs`, `ai.rs` | Child logger per command, log entry/exit/error. |
| `src-tauri/src/runner/executor.rs` | Accept `&dyn Logger`, pass env vars (`MONGOMACAPP_RUN_ID`, `MONGOMACAPP_LOGS_DIR`, `MONGOMACAPP_LOG_LEVEL`), log spawn start/exit/failure. |
| `src-tauri/src/runner/mod.rs` | Export logs dir resolver. |
| `src-tauri/src/mongo.rs` | Accept `&dyn Logger` at connection boundary; log connect/query errors with sanitised URI. |
| `src-tauri/src/keychain.rs` | Log success/failure of keychain ops (no secret values). |
| `src-tauri/Cargo.toml` | Add `tracing`, `tracing-subscriber`, `tracing-appender`. |
| `runner/harness.js` | Create logger at top; thread through helpers; log transform start, cursor materialize, emitGroup counts, errors. |
| `runner/cli.js` | Create a stderr-only logger (no file) since CLI is for manual debugging; pass into harness helpers. |

### Deployment rule

Per CLAUDE.md's harness deployment rule, after any edits to `runner/*.js`:

```bash
cp runner/harness.js ~/.mongomacapp/runner/harness.js
cp runner/logger.js ~/.mongomacapp/runner/logger.js
cp runner/redact.js ~/.mongomacapp/runner/redact.js
cp runner/query-classifier.js ~/.mongomacapp/runner/query-classifier.js
```

(And any other `runner/*.js` touched by the plan.)

---

## Error handling

**Logger failures must never crash the app.** Every adapter wraps its write in try/catch (or `Result`-swallow in Rust) and silently drops on error. A logger that can't log is still better than a crashing app.

### Failure modes

| Failure | Behaviour |
|---|---|
| Frontend IPC fails (Tauri not ready, command errored) | `IpcLogger` emits one `console.warn` per process, then silently drops records. Buffered records discarded on tab close. |
| Disk full / permission denied in Rust | `tracing-appender` already swallows. Retention sweep emits one `eprintln!` per failed file and continues. |
| Runner can't create its log file | Falls back to `NullWriter`. Script execution proceeds unaffected. Rust side logs the runner-log creation failure. |
| Malformed `log_write` payload | Backend handler returns `()`; drops record; logs a single `warn` to `backend.log`. |

### Log content safety — redaction

Every layer has a tiny `redact` helper. It is applied to `ctx` objects before formatting.

- `uri` / `mongoUri` / `connectionString` — parse the URI, replace password component with `***`. If parse fails, emit `"[unparseable-uri]"`.
- `password`, `secret`, `token`, `authorization` — replace value with `***`.
- `script` — if the field is a script body, log first 200 chars + `sha256:<hex>`. This gives correlation without dumping the user's query (may contain PII like customer ids).

Redaction is applied at the logger boundary, not at every call site — callers pass raw ctx, the adapter redacts.

---

## Testing

### Unit tests

- **Frontend (`src/__tests__/logger.test.ts`)**:
  - `MemoryLogger` — assert records array after calls.
  - `ConsoleLogger` — level filtering (debug dropped when level=info).
  - `IpcLogger` — batching: 19 records → no flush; 20th record triggers flush; 100 ms timer triggers flush; `invoke` mocked via vitest.
  - `redact.ts` — URI password redaction, script truncation + hashing, sensitive field masking.
  - Child-logger merging: `logger.child({ a: 1 }).child({ b: 2 }).info('x', { c: 3 })` produces `{ a:1, b:2, c:3 }`.

- **Rust (`src-tauri/src/logger/tests.rs`)**:
  - `TracingLogger` writes a JSON line per call; parse back, assert fields.
  - Retention sweep: populate a `tempfile::tempdir` with files dated 1, 3, 6, 8, 14 days old; assert only files > 7 days are removed.
  - Redaction equivalents.
  - `log_write` IPC handler: append to temp dir, parse back.

- **Runner (`runner/__tests__/logger.test.js`)**:
  - `FileWriter` to tempdir, parse each line as JSON, assert structure.
  - `NullWriter` drops everything without throwing.
  - Child-logger binding merge.
  - Redaction.

### Integration (manual, documented here)

1. Start the app with a fresh `~/.mongomacapp/logs/` dir.
2. Open a connection → inspect `backend.log`: expect a `connection.open` record with `connId`.
3. Execute `db.foo.find()` → capture `runId` from devtools console.
4. `grep <runId> ~/.mongomacapp/logs/*.log` → expect records in `app.log`, `backend.log`, and `runner-<runId>.log`.
5. Kill app mid-run → expect partial `runner-<runId>.log`; `backend.log` contains spawn + "runner exited" error.
6. Rename a file in `logs/` to simulate a pre-existing old rolled file with mtime 10 days ago → restart app → verify it gets removed within 24 h (or force a sweep in dev by reducing the interval).

### End-to-end assertion (optional future work)

A playwright test that drives the UI, captures the log files, and asserts the `runId` chain. Deferred — not a blocker for this spec.

---

## Open questions / future work

- **Log viewer UI.** A future spec can add an in-app viewer that tails `app.log` / `backend.log` / a chosen runner log. The port makes this a pure additive change — a new `Logger` adapter for live tailing, no caller edits.
- **Configurable level via Settings UI.** For now, the env var is enough. A Settings control can be added later that writes to a persisted config and restarts the logger.
- **Broader DI.** This spec intentionally keeps DI scoped to the logger. If the pattern proves valuable, a follow-up can extend DI to other services (mongo connection manager, keychain, AI provider) using the same constructor-injection approach — still no framework.
