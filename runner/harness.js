const { MongoClient } = require('mongodb');
const fs = require('fs');
const { createLogger } = require('./logger');
const { classify, splitStatements } = require('./query-classifier');

const uri = process.env.MONGO_URI;
if (!uri) {
  process.stderr.write(JSON.stringify({ __error: 'MONGO_URI env var is required' }) + '\n');
  process.exit(1);
}
const [dbName, scriptPath] = process.argv.slice(2);
const rawScript = fs.readFileSync(scriptPath, 'utf8');

const logger = createLogger({
  runId: process.env.MONGOMACAPP_RUN_ID || 'nil',
  logsDir: process.env.MONGOMACAPP_LOGS_DIR || null,
  level: process.env.MONGOMACAPP_LOG_LEVEL || 'info',
});

// Component-scoped child loggers — created once at module init so each query
// doesn't allocate a Logger. The `logger` field on each record stays
// filterable (e.g. grep '"logger":"harness.cursor"').
const transformLogger = logger.child({ logger: 'harness.transform' });
const cursorLogger = logger.child({ logger: 'harness.cursor' });
const emitLogger = logger.child({ logger: 'harness.emit' });

logger.info('harness start', {
  dbName,
  scriptPath,
  page: process.env.MONGO_PAGE,
  pageSize: process.env.MONGO_PAGE_SIZE,
});

const __startedAt = Date.now();
process.on('exit', (code) => {
  try {
    logger.info('harness end', { code, durationMs: Date.now() - __startedAt });
  } catch (_e) {}
});

// Set once the MongoClient is live so a termination signal can close it.
// The Rust executor sends SIGTERM (not SIGKILL) on cancel/timeout so this
// handler can release the server-side connection; without it, killed runs
// leave stale connections that accumulate across repeated cancels.
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

let groupIndex = 0;

const PAGE = parseInt(process.env.MONGO_PAGE ?? '0', 10);
const PAGE_SIZE = parseInt(process.env.MONGO_PAGE_SIZE ?? '50', 10);

// Result-set safety caps (configurable via env; <= 0 disables each one).
//   MONGO_MAX_DOCS    — max documents materialized into a single emitted group.
//                       Without this, cursor.toArray() on a large collection
//                       buffers the whole result set into memory -> OOM/UI freeze.
//   MONGO_MAX_TIME_MS — server-side per-operation time budget applied to
//                       find/aggregate cursors and their count queries, so a
//                       slow op fails fast instead of riding the 30s kill timer.
const MAX_DOCS = parseInt(process.env.MONGO_MAX_DOCS ?? '1000', 10);
const MAX_TIME_MS = parseInt(process.env.MONGO_MAX_TIME_MS ?? '30000', 10);
const COUNT_OPTIONS = MAX_TIME_MS > 0 ? { maxTimeMS: MAX_TIME_MS } : undefined;

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

// Surface an out-of-band notice (truncation, unsupported feature, ...) on the
// same `__log` channel as user print() output. The UI renders these in the
// Console tab, so a notice is visible without disturbing the result-group
// stream or its 1:1 classification alignment.
function emitNotice(message, log = emitLogger) {
  if (log) log.info('notice', { message });
  process.stdout.write(JSON.stringify({ __log: { message } }) + '\n');
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

// Pre-classify every top-level statement. The harness emits groups in
// statement order (one emitGroup call per MongoDB op, 1:1 with classified
// statements); `groupClassifications` is consumed by index as groups emit.
//
// We drop only category === null (statement isn't a MongoDB op — pure JS, etc.).
// A 'stream' (watch()) statement IS kept: makeCollectionProxy emits exactly one
// "unsupported" notice group for it, so it occupies its slot and every later
// group's classification stays aligned. (listIndexes likewise materialises in
// makeCollectionProxy, so it stays in the array.)
const groupClassifications = splitStatements(rawScript)
  .map((stmt) => classify(stmt))
  .filter((c) => c.category !== null);

function emitPagination(total, page, pageSize) {
  process.stdout.write(
    JSON.stringify({ __pagination: { total, page, pageSize } }) + '\n',
  );
}

function emitGroup(docs, log = emitLogger) {
  const arr = Array.isArray(docs) ? docs : [docs];
  const safe = JSON.parse(JSON.stringify(arr, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && v._bsontype === 'ObjectId') return v.toString();
    return v;
  }));
  const idx = groupIndex++;
  const classification = groupClassifications[idx] ?? { category: null, collection: null };
  const payload = { __group: idx, docs: safe };
  if (classification.category) payload.category = classification.category;
  if (classification.collection) payload.collection = classification.collection;
  if (log) log.debug('emitGroup', {
    count: arr.length,
    index: idx,
    category: classification.category,
    collection: classification.collection,
  });
  process.stdout.write(JSON.stringify(payload) + '\n');
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

// Wrap a Mongo cursor so users can chain modifiers (sort, limit, skip, ...)
// and also await/then the cursor directly to materialize results. emitGroup is
// invoked exactly once when the cursor is materialized.
function makeCursorProxy(cursor, countPromise, log = cursorLogger) {
  const modifiers = ['sort', 'limit', 'skip', 'project', 'hint', 'maxTimeMS', 'batchSize'];

  let userLimit = null;
  let userSkip = null;
  let promise;
  function materialize() {
    if (!promise) {
      if (countPromise !== undefined && userLimit === null && userSkip === null) {
        // Only apply pagination when the user did not explicitly chain .limit() or .skip()
        cursor = cursor.skip(PAGE * PAGE_SIZE).limit(PAGE_SIZE);
        promise = Promise.all([toArrayCapped(cursor, PAGE_SIZE), countPromise]).then(([res, total]) => {
          if (log) log.debug('cursor materialize', { count: res.docs.length, total, paginated: true, truncated: res.truncated });
          if (res.truncated) emitNotice(truncationNotice(res.docs.length), log);
          emitGroup(res.docs, log);
          emitPagination(total, PAGE, PAGE_SIZE);
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
    forEach: (fn) => cursor.toArray().then((docs) => { docs.forEach(fn); }),
    map: (fn) => cursor.toArray().then((docs) => docs.map(fn)),
    count: () => {
      const p = countPromise !== undefined ? Promise.resolve(countPromise) : cursor.toArray().then((docs) => docs.length);
      return p.then((n) => { emitGroup(n, log); return n; });
    },
    size: () => cursor.toArray().then((docs) => { emitGroup(docs.length, log); return docs.length; }),
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
      // Close it immediately (an open change-stream cursor keeps the Node event
      // loop alive and hangs the harness process), and emit a single notice
      // group so the statement is visible instead of producing silence. The
      // group occupies this statement's 'stream' classification slot, keeping
      // later groups aligned.
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
          const paginatedPipeline = [...pipeline, { $skip: PAGE * PAGE_SIZE }, { $limit: PAGE_SIZE }];
          const rawCursor = applyMaxTime(val.call(target, paginatedPipeline));
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
      // Database-level change stream (db.watch()). Unlike a collection watch it
      // has no classification slot, so surface the notice on the console (__log)
      // channel rather than as a result group, and close it to avoid hanging.
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

function extractLine(err) {
  const m = err.stack && err.stack.match(/<anonymous>:(\d+)/);
  return m ? parseInt(m[1], 10) - 1 : null;
}

async function run() {
  process.stderr.write(JSON.stringify({ __debug: `[harness] connecting to db=${dbName}` }) + '\n');
  logger.info('mongo connect start');
  // Build MongoClient options from structured credential env vars (Option B).
  // These are only set for password-based auth modes (SCRAM, LDAP). When
  // absent the URI-embedded credentials (if any) or no-auth path applies,
  // so existing URI-target connections keep working unchanged.
  const clientOptions = {};
  if (process.env.MONGO_USER) {
    clientOptions.auth = {
      username: process.env.MONGO_USER,
      password: process.env.MONGO_PASS || '',
    };
  }
  if (process.env.MONGO_AUTH_SOURCE) {
    clientOptions.authSource = process.env.MONGO_AUTH_SOURCE;
  }
  if (process.env.MONGO_AUTH_MECHANISM) {
    clientOptions.authMechanism = process.env.MONGO_AUTH_MECHANISM;
  }
  const client = new MongoClient(uri, clientOptions);
  activeClient = client;
  try {
    await client.connect();
  } catch (err) {
    logger.error('mongo connect failed', { err: String(err), stack: err && err.stack });
    process.stderr.write(JSON.stringify({ __error: err.message }) + '\n');
    process.exitCode = 1;
    return;
  }
  logger.info('mongo connect ok');
  process.stderr.write(JSON.stringify({ __debug: `[harness] connected, running script` }) + '\n');
  const db = wrapDb(client.db(dbName));
  try {
    const userScript = transformScript(rawScript, transformLogger);
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFn('db', 'print', userScript);
    // print() streams to a separate log channel (__log), not the result-group
    // channel. The UI surfaces these in a dedicated Console tab so a script
    // doing `forEach(d => print(...))` doesn't fragment results into N tabs.
    const print = (v) => {
      const message = typeof v === 'string' ? v : (() => {
        try { return JSON.stringify(v); } catch (_e) { return String(v); }
      })();
      process.stdout.write(JSON.stringify({ __log: { message } }) + '\n');
    };
    await fn(db, print);
    logger.info('script complete', { groups: groupIndex });
    process.stderr.write(JSON.stringify({ __debug: `[harness] script complete, groups=${groupIndex}` }) + '\n');
  } catch (err) {
    logger.error('script failure', {
      err: String(err),
      stack: err && err.stack,
      line: extractLine(err),
    });
    process.stderr.write(
      JSON.stringify({ __error: err.message, line: extractLine(err) }) + '\n',
    );
    process.exitCode = 1;
  } finally {
    activeClient = null;
    try { await client.close(); } catch (_e) {}
  }
}

run().catch((err) => {
  logger.error('harness fatal', { err: String(err), stack: err && err.stack });
  process.stderr.write(JSON.stringify({ __error: err.message }) + '\n');
  process.exit(1);
});
