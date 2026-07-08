// ───────────────────────────────────────────────────────────────────────────
// MongoLens runner harness — DEPLOY-BY-COPY GUARDED.
// Bundled into the Tauri binary (include_str!) and installed to
// ~/.mongomacapp/runner/harness.js. On first spawn the Rust executor compares
// the installed copy against the bundled source and logs a warning banner if
// they diverge. After editing this file you MUST redeploy:
//     cp runner/harness.js ~/.mongomacapp/runner/harness.js
//
// SERVE MODE: one long-lived process per connection. Started as
//   node harness.js --serve <defaultDb>   (env MONGO_URI required)
// It connects ONE MongoClient (kept alive) and serves many queries over an
// NDJSON request/response protocol on stdin/stdout (stderr stays for logs):
//   in:  {"__init":{"auth":{...}}}                              (once, first)
//        {"id","action":"run","db","script","page","pageSize"}
//        {"id","action":"cancel"} | {"action":"shutdown"}
//   out: {"__ready":true} | {"__error","fatal":true}            (init reply)
//        {"id","__group","docs",...} {"id","__pagination"} {"id","__log"}
//        {"id","__error","line"}     {"id","__done":true}       (TERMINAL/req)
// Every per-request response carries its request `id`; `__done` (success OR
// error) replaces "process exit = done".
// ───────────────────────────────────────────────────────────────────────────
const { MongoClient } = require('mongodb');
// EJSON ships with the mongodb driver's bson dependency (resolved via NODE_PATH).
// Used by the `data` action to round-trip BSON types (ObjectId, Date, ...) to the
// Rust side losslessly, so browse/document ops keep the same typed shape the Rust
// driver produced before these ops moved to the harness.
const { EJSON } = require('bson');
const readline = require('readline');
const { createLogger } = require('./logger');
const { classify, splitStatements } = require('./query-classifier');

const uri = process.env.MONGO_URI;
if (!uri) {
  process.stderr.write(JSON.stringify({ __error: 'MONGO_URI env var is required' }) + '\n');
  process.exit(1);
}

const logger = createLogger({
  runId: process.env.MONGOMACAPP_RUN_ID || 'nil',
  logsDir: process.env.MONGOMACAPP_LOGS_DIR || null,
  level: process.env.MONGOMACAPP_LOG_LEVEL || 'info',
});

// Default child logger reused as the per-session loggers' parent. Per-request
// child loggers (bound with reqId) are created in createSession for filterable,
// correlatable records (grep '"logger":"harness.cursor"' / '"reqId":"..."').
const transformLogger = logger.child({ logger: 'harness.transform' });

const __startedAt = Date.now();
process.on('exit', (code) => {
  try {
    logger.info('harness end', { code, durationMs: Date.now() - __startedAt });
  } catch (_e) {}
});

// Set once the MongoClient is live so a termination signal can close it.
// The Rust executor sends SIGTERM (not SIGKILL) on disconnect/timeout so this
// handler can release the server-side connection; without it, killed processes
// leave stale connections that accumulate across repeated reconnects.
let activeClient = null;
// Bound the graceful close so a hung client.close() can't outlive the SIGKILL
// the executor sends after its grace period.
const SIGTERM_CLOSE_TIMEOUT_MS = 2000;

function handleSignal(signal) {
  try { logger.info('signal received', { signal }); } catch (_e) {}
  const client = activeClient;
  activeClient = null;
  if (!client) {
    process.exit(0);
    return;
  }
  const finish = () => process.exit(0);
  Promise.resolve()
    .then(() => client.close())
    .then(finish, finish);
  setTimeout(() => process.exit(0), SIGTERM_CLOSE_TIMEOUT_MS).unref();
}
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGINT', () => handleSignal('SIGINT'));

// Result-set safety caps (configurable via env; <= 0 disables each one).
//   MONGO_MAX_DOCS    — max documents materialized into a single emitted group.
//                       Without this, cursor.toArray() on a large collection
//                       buffers the whole result set into memory -> OOM/UI freeze.
//   MONGO_MAX_TIME_MS — server-side per-operation time budget applied to
//                       find/aggregate cursors and their count queries, so a
//                       slow op fails fast instead of riding the kill timer.
const MAX_DOCS = parseInt(process.env.MONGO_MAX_DOCS ?? '1000', 10);
const MAX_TIME_MS = parseInt(process.env.MONGO_MAX_TIME_MS ?? '30000', 10);
const COUNT_OPTIONS = MAX_TIME_MS > 0 ? { maxTimeMS: MAX_TIME_MS } : undefined;

const DEFAULT_PAGE_SIZE = 50;

function applyMaxTime(cursor) {
  if (MAX_TIME_MS > 0 && cursor && typeof cursor.maxTimeMS === 'function') {
    cursor.maxTimeMS(MAX_TIME_MS);
  }
  return cursor;
}

// Materialize a cursor without buffering an unbounded result set: fetch at most
// MAX_DOCS + 1 docs so we can flag truncation, then slice to MAX_DOCS. When the
// caller already constrained the result (pagination limit or a user .limit()
// <= MAX_DOCS), that smaller bound wins and nothing is truncated.
async function toArrayCapped(cursor, effectiveLimit) {
  if (!(MAX_DOCS > 0)) {
    const docs = await cursor.toArray();
    return { docs, truncated: false };
  }
  const fetchLimit =
    effectiveLimit != null && effectiveLimit <= MAX_DOCS ? effectiveLimit : MAX_DOCS + 1;
  const fetched = await cursor.limit(fetchLimit).toArray();
  if (fetched.length > MAX_DOCS) {
    return { docs: fetched.slice(0, MAX_DOCS), truncated: true };
  }
  return { docs: fetched, truncated: false };
}

function truncationNotice(shown) {
  return `⚠ Result truncated to ${shown} documents — the query matched more. ` +
    'Add a tighter filter/.limit(), or raise MONGO_MAX_DOCS to see more.';
}

// Surfaced (as a result-group doc) when a script opens a change stream. The
// runner cannot stream live updates to the UI yet, so .watch() would otherwise
// produce silence. ResultsPanel renders the 'stream' category as a notice.
const CHANGE_STREAM_NOTICE =
  'Change streams (.watch()) are not supported yet — the cursor was closed and no live updates will appear here.';

function safeWatch(open) {
  try { return open(); } catch (_e) { return null; }
}

function closeChangeStream(stream) {
  if (!stream || typeof stream.close !== 'function') return;
  try {
    const closing = stream.close();
    if (closing && typeof closing.then === 'function') closing.catch(() => {});
  } catch (_e) { /* best-effort close */ }
}

// Transform Mongo shell-style script: add await before db. expressions so the
// user never needs to write await in their queries (Studio 3T / mongosh style).
function transformScript(script, log = transformLogger) {
  if (log) log.debug('transform', { lines: script.split('\n').length });
  return script
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      const indent = line.slice(0, line.length - trimmed.length);

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return line;
      }

      // Leave control-flow and already-async lines alone
      if (/^(await|return|throw|if|else|for|while|switch|try|catch|finally|function|class|async)/.test(trimmed)) {
        return line;
      }

      // Standalone db. expression
      if (trimmed.startsWith('db.')) {
        return `${indent}await ${trimmed}`;
      }

      // Assignment: const/let/var x = db.col.method()
      const m = trimmed.match(/^((?:const|let|var)\s+\w+\s*=\s*)db\./);
      if (m) {
        return `${indent}${m[1]}await db.${trimmed.slice(m[1].length + 3)}`;
      }

      return line;
    })
    .join('\n');
}

// Recognized Node.js driver FindOptions keys — used to detect shell-style
// raw-projection usage (find({}, {status: 1})) vs driver-style
// (find({}, {projection: {status: 1}})).
const FIND_OPTION_KEYS = new Set([
  'projection', 'sort', 'limit', 'skip', 'hint', 'maxTimeMS',
  'batchSize', 'readPreference', 'collation', 'comment', 'session',
]);

function normalizeFindOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length === 0) {
    return options;
  }
  for (const key of Object.keys(options)) {
    if (FIND_OPTION_KEYS.has(key)) return options;
  }
  return { projection: options };
}

function extractLine(err) {
  const m = err.stack && err.stack.match(/<anonymous>:(\d+)/);
  return m ? parseInt(m[1], 10) - 1 : null;
}

// Thrown by the cursor proxy when a cancel flag is observed between group
// emissions, so the run boundary can report {__error:"cancelled"} distinctly
// from a genuine script error.
class CancelledError extends Error {}

// Build MongoClient options from the structured `__init` payload the Rust
// builder resolves (the single auth/TLS seam). Mirrors src-tauri's
// connection::builder so every auth mode that connects through the Rust driver
// also connects through Node:
//   * password modes (SCRAM/LDAP) → auth {username,password} + authSource +
//     authMechanism (PLAIN for LDAP).
//   * X509 → authMechanism MONGODB-X509, authSource $external, NO username
//     (the driver lifts the DN from the TLS-presented client cert).
//   * tls block → tls + tlsCertificateKeyFile (client cert), tlsCAFile,
//     tlsAllowInvalid{Certificates,Hostnames}.
// Secrets (password) arrive only here via __init/stdin, never argv/env. When a
// field is absent the URI-embedded / no-auth path applies, so existing
// URI-target connections keep working unchanged.
function buildClientOptions(init) {
  const clientOptions = {};
  const auth = init && init.auth;
  if (auth) {
    if (auth.username) {
      clientOptions.auth = { username: auth.username, password: auth.password || '' };
    }
    if (auth.authSource) clientOptions.authSource = auth.authSource;
    if (auth.authMechanism) clientOptions.authMechanism = auth.authMechanism;
  }
  const tls = init && init.tls;
  if (tls && tls.enabled) {
    clientOptions.tls = true;
    if (tls.certKeyFile) clientOptions.tlsCertificateKeyFile = tls.certKeyFile;
    if (tls.caFile) clientOptions.tlsCAFile = tls.caFile;
    if (tls.allowInvalidCertificates) clientOptions.tlsAllowInvalidCertificates = true;
    if (tls.allowInvalidHostnames) clientOptions.tlsAllowInvalidHostnames = true;
  }
  return clientOptions;
}

// Single NDJSON writer for the response channel (stdout). Every per-request
// frame is tagged with its `id` by the caller; connection-level frames
// (__ready, fatal __error) carry none.
function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Per-request execution context. All script-execution state that used to be
// module-global (groupIndex, page/pageSize, classifications, the cursor/
// collection/db proxies and the emit functions) lives here, scoped to ONE run
// so concurrent reuse of the process never crosses request state. Execution
// semantics are unchanged from the per-process harness — only the state's
// lifetime and the `id`-tagged framing differ.
function createSession({ id, page, pageSize, script, isCancelled }) {
  const cursorLog = logger.child({ logger: 'harness.cursor', reqId: id });
  const emitLog = logger.child({ logger: 'harness.emit', reqId: id });
  const sessionTransformLog = logger.child({ logger: 'harness.transform', reqId: id });

  let groupIndex = 0;

  // Pre-classify every top-level statement. Groups emit in statement order (one
  // emitGroup per MongoDB op, 1:1 with classified statements); consumed by
  // index as groups emit. Drop only category === null (non-Mongo statements).
  // A 'stream' (watch()) statement IS kept: makeCollectionProxy emits exactly
  // one "unsupported" notice group for it, holding its slot so later groups stay
  // aligned. (listIndexes likewise materialises in makeCollectionProxy.)
  const groupClassifications = splitStatements(script)
    .map((stmt) => classify(stmt))
    .filter((c) => c.category !== null);

  // Surface an out-of-band notice (truncation, unsupported feature, ...) on the
  // same __log channel as user print() output, so it shows in the Console tab
  // without disturbing the result-group stream or its 1:1 classification.
  function emitNotice(message, log = emitLog) {
    if (log) log.info('notice', { message });
    writeLine({ id, __log: { message } });
  }

  function emitPagination(total, pageNo, size) {
    writeLine({ id, __pagination: { total, page: pageNo, pageSize: size } });
  }

  function emitGroup(docs, log = emitLog) {
    const arr = Array.isArray(docs) ? docs : [docs];
    const safe = JSON.parse(JSON.stringify(arr, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v && v._bsontype === 'ObjectId') return v.toString();
      if (v && typeof v.$numberDecimal === 'string') return v.$numberDecimal; // Decimal128.toJSON() → EJSON form
      if (v && v._bsontype === 'Long') return v.toString();
      if (v && v._bsontype === 'Binary') return v.toString('base64');
      return v;
    }));
    const idx = groupIndex++;
    const classification = groupClassifications[idx] ?? { category: null, collection: null };
    const payload = { id, __group: idx, docs: safe };
    if (classification.category) payload.category = classification.category;
    if (classification.collection) payload.collection = classification.collection;
    if (log) log.debug('emitGroup', {
      count: arr.length,
      index: idx,
      category: classification.category,
      collection: classification.collection,
    });
    writeLine(payload);
  }

  // Wrap a Mongo cursor so users can chain modifiers (sort, limit, skip, ...)
  // and also await/then the cursor directly to materialize results. emitGroup
  // is invoked exactly once when the cursor is materialized.
  function makeCursorProxy(cursor, countPromise, log = cursorLog) {
    const modifiers = ['sort', 'limit', 'skip', 'project', 'hint', 'maxTimeMS', 'batchSize'];

    let userLimit = null;
    let userSkip = null;
    let promise;
    function materialize() {
      if (!promise) {
        // Cooperative cancel checkpoint: a cancel observed before this group
        // emits aborts the run; the run boundary reports __error:"cancelled".
        if (isCancelled()) {
          promise = Promise.reject(new CancelledError('cancelled'));
          return promise;
        }
        if (countPromise !== undefined && userLimit === null && userSkip === null) {
          // Only apply pagination when the user did not explicitly chain .limit() or .skip()
          cursor = cursor.skip(page * pageSize).limit(pageSize);
          promise = Promise.all([toArrayCapped(cursor, pageSize), countPromise]).then(([res, total]) => {
            if (log) log.debug('cursor materialize', { count: res.docs.length, total, paginated: true, truncated: res.truncated });
            if (res.truncated) emitNotice(truncationNotice(res.docs.length), log);
            emitGroup(res.docs, log);
            emitPagination(total, page, pageSize);
            return res.docs;
          });
        } else {
          promise = toArrayCapped(cursor, userLimit).then((res) => {
            if (log) log.debug('cursor materialize', { count: res.docs.length, paginated: false, truncated: res.truncated });
            if (res.truncated) emitNotice(truncationNotice(res.docs.length), log);
            emitGroup(res.docs, log);
            return res.docs;
          });
        }
      }
      return promise;
    }

    const proxy = {
      then: (res, rej) => materialize().then(res, rej),
      catch: (rej) => materialize().catch(rej),
      finally: (fn) => materialize().finally(fn),
      toArray: () => materialize(),
      forEach: (fn) => toArrayCapped(cursor, userLimit).then(({ docs }) => { docs.forEach(fn); }),
      map: (fn) => toArrayCapped(cursor, userLimit).then(({ docs }) => docs.map(fn)),
      count: () => {
        const p = countPromise !== undefined ? Promise.resolve(countPromise) : toArrayCapped(cursor, userLimit).then(({ docs }) => docs.length);
        return p.then((n) => { emitGroup(n, log); return n; });
      },
      size: () => toArrayCapped(cursor, userLimit).then(({ docs }) => { emitGroup(docs.length, log); return docs.length; }),
      explain: (verbosity) => cursor.explain(verbosity).then((plan) => { emitGroup(plan, log); return plan; }),
    };

    modifiers.forEach((m) => {
      if (typeof cursor[m] === 'function') {
        proxy[m] = (...args) => {
          if (m === 'limit') userLimit = args[0];
          if (m === 'skip') userSkip = args[0];
          cursor = cursor[m](...args);
          return proxy;
        };
      }
    });

    return proxy;
  }

  function makeCollectionProxy(col) {
    return new Proxy(col, {
      get(target, prop) {
        if (typeof prop !== 'string') return target[prop];

        // Shell-compat alias: getIndexes() -> indexes()
        if (prop === 'getIndexes') {
          return () =>
            target.indexes().then((docs) => {
              emitGroup(docs);
              return docs;
            });
        }

        // listIndexes returns a cursor, not a promise — materialize and emit
        // so the single call produces exactly one group (matches classifier
        // expectation). Without this wrap, groupClassifications[idx] would
        // skew for any subsequent emitted statement.
        if (prop === 'listIndexes') {
          return (...args) =>
            target.listIndexes(...args).toArray().then((docs) => {
              emitGroup(docs);
              return docs;
            });
        }

        // watch returns a long-lived ChangeStream the UI cannot consume yet.
        // Close it immediately (an open change-stream cursor keeps the Node
        // event loop alive) and emit a single notice group so the statement is
        // visible instead of producing silence. The group occupies this
        // statement's 'stream' classification slot, keeping later groups aligned.
        if (prop === 'watch') {
          return (...args) => {
            closeChangeStream(safeWatch(() => target.watch(...args)));
            emitGroup({ notice: CHANGE_STREAM_NOTICE });
            return null;
          };
        }

        const val = target[prop];
        if (typeof val !== 'function') return val;

        // find/aggregate: paginated cursors
        if (prop === 'find') {
          return (filter = {}, options) => {
            const normalizedOptions = normalizeFindOptions(options);
            const rawCursor = applyMaxTime(val.call(target, filter, normalizedOptions));
            // Empty filter: use estimatedDocumentCount() (reads collection
            // metadata, O(1)) instead of countDocuments({}) which forces a
            // COLLSCAN and hangs on large collections.
            const isEmptyFilter =
              filter && typeof filter === 'object' && Object.keys(filter).length === 0;
            const countPromise = isEmptyFilter
              ? target.estimatedDocumentCount(COUNT_OPTIONS).catch(() => -1)
              : target.countDocuments(filter, COUNT_OPTIONS).catch(() => -1);
            return makeCursorProxy(rawCursor, countPromise);
          };
        }
        if (prop === 'aggregate') {
          return (pipeline = []) => {
            const lastStage = pipeline[pipeline.length - 1];
            const isTerminal = lastStage && ('$merge' in lastStage || '$out' in lastStage);
            if (isTerminal) {
              // Terminal stages ($merge/$out) must be last — skip pagination
              return makeCursorProxy(applyMaxTime(val.call(target, pipeline)));
            }
            // materialize() applies skip/limit via AggregationCursor.addStage(); baking
            // them into the pipeline too causes double-skip on page 2+ (empty results).
            const rawCursor = applyMaxTime(val.call(target, pipeline));
            const countPipeline = [...pipeline, { $count: 'total' }];
            const countPromise = applyMaxTime(target.aggregate(countPipeline)).toArray()
              .then((r) => (r[0]?.total ?? 0))
              .catch(() => -1);
            return makeCursorProxy(rawCursor, countPromise);
          };
        }

        // All other methods: auto-capture Promise results
        return (...args) => {
          const op = val.call(target, ...args);
          if (!op) return op;
          if (typeof op.then === 'function') {
            return op.then((r) => { emitGroup(r === undefined ? null : r); return r; });
          }
          return op;
        };
      },
    });
  }

  function wrapDb(raw) {
    return new Proxy(raw, {
      get(target, prop) {
        if (prop === 'collection' || prop === 'getCollection') {
          return (n) => makeCollectionProxy(target.collection(n));
        }
        // Database-level change stream (db.watch()). Unlike a collection watch
        // it has no classification slot, so surface the notice on the console
        // (__log) channel rather than as a result group, and close it to avoid
        // hanging.
        if (prop === 'watch') {
          return (...args) => {
            closeChangeStream(safeWatch(() => target.watch(...args)));
            emitNotice(CHANGE_STREAM_NOTICE);
            return null;
          };
        }
        const val = target[prop];
        if (val === undefined && typeof prop === 'string' && !prop.startsWith('_')) {
          return makeCollectionProxy(target.collection(prop));
        }
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }

  // Run the user script against a raw mongodb Db. Resolves when the script
  // completes; rejects with CancelledError on cancel or the script's own error.
  async function execute(rawDb) {
    const db = wrapDb(rawDb);
    const userScript = transformScript(script, sessionTransformLog);
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFn('db', 'print', userScript);
    // print() streams to a separate log channel (__log), not the result-group
    // channel. The UI surfaces these in a dedicated Console tab so a script
    // doing `forEach(d => print(...))` doesn't fragment results into N tabs.
    const print = (v) => {
      const message = typeof v === 'string' ? v : (() => {
        try { return JSON.stringify(v); } catch (_e) { return String(v); }
      })();
      writeLine({ id, __log: { message } });
    };
    await fn(db, print);
    return groupIndex;
  }

  return { execute };
}

// ─── Serve loop ─────────────────────────────────────────────────────────────
// One MongoClient for the process lifetime; `run` requests execute serially in
// FIFO order. // ponytail: serial per connection — a worker pool / per-tab
// concurrency only if real concurrent-tab demand appears; the Rust side already
// demuxes by request id, so the upgrade is local to this loop.

const args = process.argv.slice(2);
const serveIdx = args.indexOf('--serve');
if (serveIdx === -1) {
  process.stderr.write(JSON.stringify({ __error: 'harness requires --serve <defaultDb>' }) + '\n');
  process.exit(1);
}
const defaultDb = args[serveIdx + 1] || '';

let client = null;
let initialized = false;
const queue = [];
let processing = false;
// The currently-executing request: { id, cancelled }. A cancel sets `cancelled`
// which the session's cursor proxy observes between group emissions.
let current = null;

async function doInit(init) {
  logger.info('mongo connect start');
  try {
    client = new MongoClient(uri, buildClientOptions(init));
    activeClient = client;
    await client.connect();
  } catch (err) {
    logger.error('mongo connect failed', { err: String(err), stack: err && err.stack });
    writeLine({ __error: err.message, fatal: true });
    process.exit(1);
    return;
  }
  logger.info('mongo connect ok');
  // stderr breadcrumb (logger may sink to a file/NullWriter): one observable
  // "connected" line per process, so a reconnect would be visible in logs.
  process.stderr.write(JSON.stringify({ __debug: 'mongo connect ok' }) + '\n');
  writeLine({ __ready: true });
}

async function runScript(req) {
  const id = req.id;
  if (!client) {
    writeLine({ id, __error: 'harness shutting down' });
    writeLine({ id, __done: true });
    return;
  }
  const dbName = req.db || defaultDb;
  const page = Math.max(0, Number.isInteger(req.page) ? req.page : 0);
  const pageSize = Number.isInteger(req.pageSize) && req.pageSize > 0 ? req.pageSize : DEFAULT_PAGE_SIZE;
  const reqLog = logger.child({ reqId: id });
  reqLog.info('run start', { dbName, page, pageSize });

  const session = createSession({
    id,
    page,
    pageSize,
    script: req.script || '',
    isCancelled: () => current != null && current.cancelled,
  });

  try {
    const groups = await session.execute(client.db(dbName));
    reqLog.info('run complete', { groups });
    writeLine({ id, __done: true });
  } catch (err) {
    if (err instanceof CancelledError) {
      reqLog.info('run cancelled');
      writeLine({ id, __error: 'cancelled' });
    } else {
      reqLog.error('run failure', { err: String(err), stack: err && err.stack, line: extractLine(err) });
      writeLine({ id, __error: err.message, line: extractLine(err) });
    }
    writeLine({ id, __done: true });
  }
}

// ─── Data ops ─────────────────────────────────────────────────────────────
// Control-plane / document operations the Rust commands used to run via the
// mongodb Rust driver (list databases/collections/indexes, browse, update,
// delete). They now share this connection's one MongoClient so the harness is
// the SINGLE Mongo data path. Each op returns a structured result the Rust side
// reshapes into the unchanged typed command return. Filters/updates and result
// documents cross the wire as canonical Extended JSON so BSON types (ObjectId,
// Date, ...) survive losslessly — the Rust driver-shaped output is preserved.
//
// Implement a new op by adding an entry here; the Rust caller and the serve
// loop need no change (registry keyed by op name — open/closed).
const DATA_OPS = {
  async listDatabases() {
    const res = await client.db().admin().listDatabases({ nameOnly: true });
    // Match the Rust command: hide the internal `local` database.
    return res.databases.map((d) => d.name).filter((n) => n !== 'local');
  },
  async listCollections(db) {
    const cols = await db
      .listCollections({}, { nameOnly: true, authorizedCollections: true })
      .toArray();
    return cols.map((c) => c.name).sort();
  },
  async listIndexes(db, req) {
    const idx = await db.collection(req.collection).listIndexes().toArray();
    return EJSON.serialize(idx, { relaxed: false });
  },
  async find(db, req) {
    const coll = db.collection(req.collection);
    const filter = EJSON.deserialize(req.filter || {});
    const page = Math.max(0, Number.isInteger(req.page) ? req.page : 0);
    const pageSize =
      Number.isInteger(req.pageSize) && req.pageSize > 0 ? req.pageSize : DEFAULT_PAGE_SIZE;
    // Empty filter: estimatedDocumentCount() is O(1); countDocuments({}) forces a COLLSCAN.
    const isEmptyFilter = filter && typeof filter === 'object' && Object.keys(filter).length === 0;
    const total = isEmptyFilter
      ? await coll.estimatedDocumentCount(COUNT_OPTIONS).catch(() => -1)
      : await coll.countDocuments(filter, COUNT_OPTIONS).catch(() => -1);
    const cursor = applyMaxTime(coll.find(filter).skip(page * pageSize).limit(pageSize));
    const docs = await cursor.toArray();
    return { docs: EJSON.serialize(docs, { relaxed: false }), total, page, pageSize };
  },
  async updateOne(db, req) {
    const result = await db
      .collection(req.collection)
      .updateOne(EJSON.deserialize(req.filter || {}), EJSON.deserialize(req.update || {}));
    return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  },
  async deleteOne(db, req) {
    const result = await db
      .collection(req.collection)
      .deleteOne(EJSON.deserialize(req.filter || {}));
    return { deletedCount: result.deletedCount };
  },
  async analyzeSchema(db, req) {
    const { parseSchema } = require('mongodb-schema');
    const size =
      Number.isInteger(req.sampleSize) && req.sampleSize > 0 ? req.sampleSize : 1000;
    const cursor = applyMaxTime(
      db.collection(req.collection).aggregate([{ $sample: { size } }], { allowDiskUse: true }),
    );
    const schema = await parseSchema(cursor);
    // relaxed=true: schema is metadata (probabilities, counts), not BSON docs — native JSON numbers are correct here.
    return {
      schema: EJSON.serialize(schema, { relaxed: true }),
      sampled: schema.count,
      sampleSize: size,
    };
  },
};

async function runData(req) {
  const id = req.id;
  if (!client) {
    writeLine({ id, __error: 'harness shutting down' });
    writeLine({ id, __done: true });
    return;
  }
  const op = DATA_OPS[req.op];
  if (!op) {
    writeLine({ id, __error: `unknown data op: ${req.op}` });
    writeLine({ id, __done: true });
    return;
  }
  const reqLog = logger.child({ reqId: id });
  reqLog.info('data start', { op: req.op, db: req.db });
  try {
    const data = await op(client.db(req.db || defaultDb), req);
    writeLine({ id, __data: data });
    writeLine({ id, __done: true });
    reqLog.info('data complete', { op: req.op });
  } catch (err) {
    reqLog.error('data failure', { op: req.op, err: String(err), code: err && err.code });
    // `code` lets the Rust side replay driver-specific fallbacks (e.g. the
    // Unauthorized=13 degrade in list_databases) instead of string-matching.
    const frame = { id, __error: err.message };
    if (err && err.code !== undefined) frame.code = err.code;
    writeLine(frame);
    writeLine({ id, __done: true });
  }
}

function pump() {
  if (processing) return;
  const req = queue.shift();
  if (!req) return;
  processing = true;
  current = { id: req.id, cancelled: false };
  // user-script errors are caught inside runScript; this .finally only advances
  // the queue, so a fatal bug can't wedge the loop.
  runScript(req).finally(() => {
    processing = false;
    current = null;
    pump();
  });
}

function handleCancel(targetId) {
  if (current && current.id === targetId) {
    // In-flight: cooperative — the cursor proxy reports cancelled + __done.
    // ponytail: a cancel during a blocking driver call can't interrupt it; the
    // run finishes naturally. Add op-level abort signals only if users hit it.
    current.cancelled = true;
    return;
  }
  const idx = queue.findIndex((r) => r.id === targetId);
  if (idx >= 0) {
    queue.splice(idx, 1);
    writeLine({ id: targetId, __error: 'cancelled' });
    writeLine({ id: targetId, __done: true });
  }
  // Unknown / already-finished id: nothing to cancel.
}

async function handleShutdown() {
  logger.info('shutdown requested');
  const c = client;
  client = null;
  activeClient = null;
  try { if (c) await c.close(); } catch (_e) {}
  process.exit(0);
}

function onLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (_e) {
    // A malformed request line can't be attributed to a request id; drop it
    // rather than crash the long-lived process.
    logger.warn('dropping malformed request line');
    return;
  }

  if (!initialized) {
    // The protocol's first line MUST be __init; ignore anything before it.
    if (msg.__init === undefined) return;
    initialized = true;
    doInit(msg.__init);
    return;
  }

  if (msg.action === 'shutdown') { handleShutdown(); return; }
  if (msg.action === 'cancel') { handleCancel(msg.id); return; }
  // Guard: client is set to null during shutdown; ignore run/data after that.
  if (msg.action === 'run') { if (client) { queue.push(msg); pump(); } return; }
  // Data ops are fast control-plane calls; run them directly (off the serial
  // run queue) — the driver multiplexes them safely on the shared client.
  if (msg.action === 'data') { if (client) { runData(msg); } return; }
  // Unknown action: ignore (forward-compat with newer request types).
}

logger.info('harness start', { mode: 'serve', defaultDb });
readline.createInterface({ input: process.stdin }).on('line', onLine);
