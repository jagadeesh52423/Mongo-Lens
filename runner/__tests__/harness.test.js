import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import net from 'net';
import readline from 'readline';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const HARNESS_PATH = path.resolve(__dirname, '..', 'harness.js');
const MONGO_MODULES_DIR = path.join(os.homedir(), '.mongomacapp', 'runner', 'node_modules');
const mongodbInstalled = fs.existsSync(path.join(MONGO_MODULES_DIR, 'mongodb'));

const DEFAULTS = {
  uri: 'mongodb://localhost:27017',
  db: 'marketplace',
  page: 0,
  pageSize: 10,
};

// Quick TCP probe — skip the whole suite if mongod is unreachable.
async function mongodReachable(uri = DEFAULTS.uri) {
  const url = new URL(uri);
  const port = parseInt(url.port) || 27017;
  const host = url.hostname || '127.0.0.1';
  return new Promise((resolve) => {
    const s = net.createConnection(port, host);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 500);
  });
}

const canRun = mongodbInstalled && await mongodReachable();

// --- Serve-protocol harness driver ---

function spawnChild(db, uri, env = {}) {
  return spawn(process.execPath, [HARNESS_PATH, '--serve', db], {
    env: { ...process.env, MONGO_URI: uri, NODE_PATH: MONGO_MODULES_DIR, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

class HarnessClient {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this._exitCode = null;
    this._readyP = new Promise((res, rej) => { this._readyRes = res; this._readyRej = rej; });
    this._exitP = new Promise((r) => { this._exitRes = r; });
    child.on('exit', (code) => { this._exitCode = code; this._exitRes(); });
    readline.createInterface({ input: child.stdout }).on('line', (l) => this._onLine(l));
  }

  _onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.__ready) { this._readyRes(); return; }
    if (msg.fatal) { this._readyRej(new Error(msg.__error || 'fatal harness error')); return; }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    if (msg.__group !== undefined) entry.acc.groups.push(msg);
    else if (msg.__pagination) entry.acc.pagination = msg.__pagination;
    else if (msg.__log) entry.acc.logs.push(msg.__log.message);
    else if (msg.__data !== undefined) entry.acc.data = msg.__data;
    else if (msg.__error !== undefined) entry.acc.error = msg.__error;
    if (msg.__done) { this.pending.delete(msg.id); entry.resolve(entry.acc); }
  }

  _send(obj) { this.child.stdin.write(JSON.stringify(obj) + '\n'); }

  async init() { this._send({ __init: {} }); return this._readyP; }

  _register(id) {
    const acc = { groups: [], logs: [], pagination: null, data: undefined, error: null };
    return new Promise((resolve) => this.pending.set(id, { resolve, acc }));
  }

  run(req) {
    const p = this._register(req.id);
    this._send({ ...req, action: 'run' });
    return p;
  }

  data(req) {
    const p = this._register(req.id);
    this._send({ ...req, action: 'data' });
    return p;
  }

  async shutdown() { this._send({ action: 'shutdown' }); return this._exitP; }
}

let _id = 0;
const nextId = () => `t${++_id}`;

async function spawnHarness(script, opts = {}) {
  const { uri, db, page, pageSize, env } = { ...DEFAULTS, ...opts };
  const child = spawnChild(db, uri, env);
  const client = new HarnessClient(child);
  await client.init();
  const result = await client.run({ id: nextId(), db, script, page, pageSize });
  await client.shutdown();
  // ponytail: serve-mode errors are per-request; synthesise exit code for the error test.
  result.exitCode = result.error ? 1 : 0;
  return result;
}

// ---------------------------------------------------------------------------

describe.skipIf(!canRun)('harness integration tests', () => {
  it('basic find returns docs with _id', async () => {
    const result = await spawnHarness('db.alert_tracker.find({})');
    expect(result.error).toBeNull();
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups[0].docs.length).toBeGreaterThan(0);
    expect(result.groups[0].docs[0]).toHaveProperty('_id');
  });

  it('sort descending by status returns docs in non-increasing order', async () => {
    const result = await spawnHarness('db.alert_tracker.find({}).sort({status: -1})');
    expect(result.error).toBeNull();
    const docs = result.groups[0].docs;
    for (let i = 0; i < docs.length - 1; i++) {
      expect(docs[i].status >= docs[i + 1].status).toBe(true);
    }
  });

  it('shell-style projection limits fields to _id and status', async () => {
    const result = await spawnHarness('db.alert_tracker.find({}, {status: 1})');
    expect(result.error).toBeNull();
    const doc = result.groups[0].docs[0];
    expect(Object.keys(doc).sort()).toEqual(['_id', 'status']);
  });

  it('driver-style projection limits fields to _id and status', async () => {
    const result = await spawnHarness('db.alert_tracker.find({}, {projection: {status: 1}})');
    expect(result.error).toBeNull();
    const doc = result.groups[0].docs[0];
    expect(Object.keys(doc).sort()).toEqual(['_id', 'status']);
  });

  it('pagination emits a positive total', async () => {
    const result = await spawnHarness('db.alert_tracker.find({})', { pageSize: 5 });
    expect(result.error).toBeNull();
    expect(result.pagination).not.toBeNull();
    expect(result.pagination.total).toBeGreaterThan(0);
  });

  it('pagination offset returns different docs on page 0 vs page 1', async () => {
    const page0 = await spawnHarness('db.alert_tracker.find({})', { page: 0, pageSize: 5 });
    const page1 = await spawnHarness('db.alert_tracker.find({})', { page: 1, pageSize: 5 });
    expect(page0.error).toBeNull();
    expect(page1.error).toBeNull();

    const ids0 = new Set(page0.groups[0].docs.map((d) => String(d._id)));
    const ids1 = new Set(page1.groups[0].docs.map((d) => String(d._id)));
    for (const id of ids1) {
      expect(ids0.has(id)).toBe(false);
    }
  });

  it('aggregate groups by status and returns a positive pending count', async () => {
    const result = await spawnHarness(
      'db.alert_tracker.aggregate([{$group:{_id:"$status",count:{$sum:1}}}])',
    );
    expect(result.error).toBeNull();
    const pendingEntry = result.groups[0].docs.find((d) => d._id === 'pending');
    expect(pendingEntry).toBeDefined();
    expect(pendingEntry.count).toBeGreaterThan(0);
  });

  it('cursor.count() emits a numeric group and no doc list', async () => {
    const result = await spawnHarness('db.alert_tracker.find({}).count()');
    expect(result.error).toBeNull();
    expect(result.groups.length).toBe(1);
    const docs = result.groups[0].docs;
    expect(docs.length).toBe(1);
    expect(typeof docs[0]).toBe('number');
    expect(docs[0]).toBeGreaterThan(0);
  });

  it('cursor.size() emits a numeric group', async () => {
    const result = await spawnHarness('db.alert_tracker.find({}).size()');
    expect(result.error).toBeNull();
    expect(result.groups.length).toBe(1);
    expect(typeof result.groups[0].docs[0]).toBe('number');
  });

  it('cursor.forEach() iterates without auto-emitting the doc list', async () => {
    const result = await spawnHarness(
      'db.alert_tracker.find({}).forEach(d => print(String(d._id)))',
      { pageSize: 3 },
    );
    expect(result.error).toBeNull();
    for (const g of result.groups) {
      expect(Array.isArray(g.docs) && g.docs.length > 1).toBe(false);
    }
  });

  it('cursor.map() returns a transformed array without auto-emitting', async () => {
    const result = await spawnHarness(
      'const ids = await db.alert_tracker.find({}).map(d => d._id); print("len=" + ids.length)',
      { pageSize: 3 },
    );
    expect(result.error).toBeNull();
    // print() routes to __log → result.logs, not result.groups
    const printed = result.logs.find((m) => typeof m === 'string' && m.startsWith('len='));
    expect(printed).toBeDefined();
  });

  it('caps the result set at MONGO_MAX_DOCS and emits a truncation notice', async () => {
    const result = await spawnHarness('db.alert_tracker.find({})', {
      pageSize: 50,
      env: { MONGO_MAX_DOCS: '1' },
    });
    expect(result.error).toBeNull();
    expect(result.groups.length).toBe(1);
    expect(result.groups[0].docs.length).toBe(1);
    expect(result.logs.some((m) => /truncat/i.test(m))).toBe(true);
  });

  it('does not flag truncation when the result fits under MONGO_MAX_DOCS', async () => {
    const result = await spawnHarness('db.alert_tracker.find({})', {
      pageSize: 3,
      env: { MONGO_MAX_DOCS: '1000' },
    });
    expect(result.error).toBeNull();
    expect(result.groups[0].docs.length).toBeLessThanOrEqual(3);
    expect(result.logs.some((m) => /truncat/i.test(m))).toBe(false);
  });

  it('cursor.explain() emits a plan group', async () => {
    const result = await spawnHarness('db.alert_tracker.find({}).explain()');
    expect(result.error).toBeNull();
    expect(result.groups.length).toBe(1);
    const plan = result.groups[0].docs[0];
    expect(plan).toBeDefined();
    expect(typeof plan).toBe('object');
    expect(plan.queryPlanner || plan.stages || plan.command).toBeTruthy();
  });

  it('change stream (.watch()) emits an unsupported notice and exits cleanly', async () => {
    const result = await spawnHarness('db.alert_tracker.watch()');
    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0].category).toBe('stream');
    expect(result.groups[0].docs[0]).toHaveProperty('notice');
    expect(result.groups[0].docs[0].notice).toMatch(/not supported/i);
  });

  it('keeps group classification aligned when a watch sits between queries', async () => {
    const result = await spawnHarness(
      'db.alert_tracker.find({});\ndb.alert_tracker.watch();\ndb.alert_tracker.find({});',
      { pageSize: 2 },
    );
    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.groups.length).toBe(3);
    expect(result.groups[0].category).toBe('query');
    expect(result.groups[1].category).toBe('stream');
    expect(result.groups[2].category).toBe('query');
  });

  it('SIGTERM mid-run closes the client and exits cleanly (code 0)', async () => {
    const child = spawnChild(DEFAULTS.db, DEFAULTS.uri);
    const client = new HarnessClient(child);
    await client.init();
    // Long-running script so SIGTERM interrupts while the harness is mid-execute.
    client.run({
      id: nextId(), db: DEFAULTS.db, page: 0, pageSize: 5,
      script: 'await db.alert_tracker.find({}).toArray();\nawait new Promise((r) => setTimeout(r, 10000));',
    }).catch(() => {});
    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
      setTimeout(() => child.kill('SIGTERM'), 1500);
    });
    expect(exitCode).toBe(0);
  });

  it('invalid syntax produces an error and non-zero exit code', async () => {
    const result = await spawnHarness('db.alert_tracker.find(INVALID');
    expect(result.error).not.toBeNull();
    expect(result.exitCode).toBe(1);
  });

  // B5: negative page clamps to 0 — same first page as explicit page 0
  it('B5: page -1 clamps to page 0, returns same docs as explicit page 0', async () => {
    const page0 = await spawnHarness('db.alert_tracker.find({}).sort({_id:1})', { page: 0, pageSize: 5 });
    const pageNeg = await spawnHarness('db.alert_tracker.find({}).sort({_id:1})', { page: -1, pageSize: 5 });
    expect(pageNeg.error).toBeNull();
    expect(page0.error).toBeNull();
    const ids0 = page0.groups[0].docs.map((d) => String(d._id));
    const idsNeg = pageNeg.groups[0].docs.map((d) => String(d._id));
    expect(idsNeg).toEqual(ids0);
  });

  // B2: DATA_OPS.find with empty filter uses estimatedDocumentCount (O(1)) not COLLSCAN
  it('B2: data-plane find with empty filter returns valid total and docs array', async () => {
    const child = spawnChild(DEFAULTS.db, DEFAULTS.uri);
    const client = new HarnessClient(child);
    await client.init();
    const result = await client.data({
      id: nextId(), op: 'find', db: DEFAULTS.db, collection: 'alert_tracker',
      filter: {}, page: 0, pageSize: 5,
    });
    await client.shutdown();
    expect(result.error).toBeNull();
    expect(result.data.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.data.docs)).toBe(true);
  });

  // Decimal128 fields must serialize as their decimal string, not {} (data loss)
  it('Decimal128 field serializes as its decimal string, not {}', async () => {
    const mongoRequire = createRequire(path.join(MONGO_MODULES_DIR, '..', 'anchor.js'));
    const { MongoClient, Decimal128 } = mongoRequire('mongodb');

    const tmpCol = 'harness_test_dec128_tmp';
    const tmpClient = new MongoClient(DEFAULTS.uri);
    await tmpClient.connect();
    const col = tmpClient.db(DEFAULTS.db).collection(tmpCol);
    await col.deleteMany({});
    await col.insertOne({ amount: Decimal128.fromString('123.45') });

    try {
      const result = await spawnHarness(`db.${tmpCol}.find({})`);
      expect(result.error).toBeNull();
      expect(result.groups.length).toBeGreaterThan(0);
      expect(result.groups[0].docs[0].amount).toBe('123.45');
    } finally {
      await col.deleteMany({});
      await tmpClient.close();
    }
  });

  // B3: forEach emits a truncation notice when toArrayCapped caps the result
  it('B3: forEach over a >MAX_DOCS set emits a truncation notice', async () => {
    const result = await spawnHarness(
      'db.alert_tracker.find({}).forEach(d => {})',
      { env: { MONGO_MAX_DOCS: '1' } },
    );
    expect(result.error).toBeNull();
    expect(result.logs.some((m) => /truncat/i.test(m))).toBe(true);
  });

  // Long fields must serialize as their exact integer string, not {low, high, unsigned} (data loss)
  it('Long field serializes as its exact integer string, not {low,high}', async () => {
    const mongoRequire = createRequire(path.join(MONGO_MODULES_DIR, '..', 'anchor.js'));
    const { MongoClient, Long } = mongoRequire('mongodb');

    const tmpCol = 'harness_test_long_tmp';
    const tmpClient = new MongoClient(DEFAULTS.uri);
    await tmpClient.connect();
    const col = tmpClient.db(DEFAULTS.db).collection(tmpCol);
    await col.deleteMany({});
    // 2^53+1: exceeds MAX_SAFE_INTEGER so the driver returns a Long object (not auto-promoted)
    await col.insertOne({ count: Long.fromString('9007199254740993') });

    try {
      const result = await spawnHarness(`db.${tmpCol}.find({})`);
      expect(result.error).toBeNull();
      expect(result.groups.length).toBeGreaterThan(0);
      expect(result.groups[0].docs[0].count).toBe('9007199254740993');
    } finally {
      await col.deleteMany({});
      await tmpClient.close();
    }
  });
});

// Regression guard for the filtered-query timeout: the advisory count query
// must fail EARLIER than the Rust run deadline. When the two budgets were both
// 30s, an unindexed countDocuments() COLLSCAN could only settle at t=30s — the
// exact moment SCRIPT_TIMEOUT_SECS fired — so every `find({filter})` on a large
// collection surfaced as "timed out" while `find()` (estimatedDocumentCount,
// O(1)) worked. Source-level assert: no mongod, no slow fixture needed.
// ponytail: greps the constants; a behavioural test needs a multi-GB unindexed
// collection. Swap to that only if these ever stop being plain literals.
describe('count budget vs run deadline', () => {
  // Every harness-side budget must expire before the Rust side hangs up —
  // otherwise the harness can only ever report its error too late, and the user
  // sees a generic "timed out" instead of the real one (or nothing at all).
  it('harness budgets are strictly below both Rust deadlines', () => {
    const harness = fs.readFileSync(HARNESS_PATH, 'utf8');
    const src = (...p) => fs.readFileSync(path.resolve(__dirname, '..', '..', 'src-tauri', 'src', ...p), 'utf8');

    const num = (text, re) => Number(text.match(re)?.[1]);
    const countMs = num(harness, /MONGO_COUNT_MAX_TIME_MS \?\? '(\d+)'/);
    const cursorMs = num(harness, /MONGO_MAX_TIME_MS \?\? '(\d+)'/);
    const scriptSecs = num(src('commands', 'script.rs'), /SCRIPT_TIMEOUT_SECS:\s*u64\s*=\s*(\d+)/);
    const dataSecs = num(src('mongo', 'mod.rs'), /DATA_TIMEOUT_SECS:\s*u64\s*=\s*(\d+)/);

    for (const v of [countMs, cursorMs, scriptSecs, dataSecs]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    const deadlineMs = Math.min(scriptSecs, dataSecs) * 1000;
    expect(cursorMs).toBeLessThan(deadlineMs);
    expect(countMs).toBeLessThan(deadlineMs);
    expect(countMs).toBeLessThanOrEqual(cursorMs); // count is advisory; never the longest pole
  });

  it('count uses its own budget, not the cursor MAX_TIME_MS', () => {
    const harness = fs.readFileSync(HARNESS_PATH, 'utf8');
    expect(harness).toMatch(/const COUNT_OPTIONS = COUNT_MAX_TIME_MS > 0/);
    // aggregate's $count must not ride applyMaxTime (the 30s cursor budget)
    expect(harness).not.toMatch(/applyMaxTime\(target\.aggregate\(countPipeline\)\)/);
  });
});
