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

let groupIndex = 0;

const PAGE = parseInt(process.env.MONGO_PAGE ?? '0', 10);
const PAGE_SIZE = parseInt(process.env.MONGO_PAGE_SIZE ?? '50', 10);

// Pre-classify every top-level statement. The harness emits groups in
// statement order (one emitGroup call per MongoDB op, 1:1 with classified
// statements); `groupClassifications` is consumed by index as groups emit.
//
// We drop two kinds of classifications to keep that 1:1 alignment:
//   - category === null: statement isn't a MongoDB op (pure JS, etc.)
//   - category === 'stream': watch() returns an infinite ChangeStream and
//     has no terminal value to emit. Including it would shift every later
//     group's classification by one.
// (listIndexes is handled by materialising in makeCollectionProxy, so it
// stays in the array.)
const groupClassifications = splitStatements(rawScript)
  .map((stmt) => classify(stmt))
  .filter((c) => c.category !== null && c.category !== 'stream');

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
        promise = Promise.all([cursor.toArray(), countPromise]).then(([docs, total]) => {
          if (log) log.debug('cursor materialize', { count: docs.length, total, paginated: true });
          emitGroup(docs, log);
          emitPagination(total, PAGE, PAGE_SIZE);
          return docs;
        });
      } else {
        promise = cursor.toArray().then((docs) => {
          if (log) log.debug('cursor materialize', { count: docs.length, paginated: false });
          emitGroup(docs, log);
          return docs;
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

      const val = target[prop];
      if (typeof val !== 'function') return val;

      // find/aggregate: paginated cursors
      if (prop === 'find') {
        return (filter = {}, options) => {
          const normalizedOptions = normalizeFindOptions(options);
          const rawCursor = val.call(target, filter, normalizedOptions);
          const countPromise = target.countDocuments(filter).catch(() => -1);
          return makeCursorProxy(rawCursor, countPromise);
        };
      }
      if (prop === 'aggregate') {
        return (pipeline = []) => {
          const lastStage = pipeline[pipeline.length - 1];
          const isTerminal = lastStage && ('$merge' in lastStage || '$out' in lastStage);
          if (isTerminal) {
            // Terminal stages ($merge/$out) must be last — skip pagination
            return makeCursorProxy(val.call(target, pipeline));
          }
          const paginatedPipeline = [...pipeline, { $skip: PAGE * PAGE_SIZE }, { $limit: PAGE_SIZE }];
          const rawCursor = val.call(target, paginatedPipeline);
          const countPipeline = [...pipeline, { $count: 'total' }];
          const countPromise = target.aggregate(countPipeline).toArray()
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
  const client = new MongoClient(uri);
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
    const print = (v) => emitGroup(v, emitLogger);
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
    try { await client.close(); } catch (_e) {}
  }
}

run().catch((err) => {
  logger.error('harness fatal', { err: String(err), stack: err && err.stack });
  process.stderr.write(JSON.stringify({ __error: err.message }) + '\n');
  process.exit(1);
});
