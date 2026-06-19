#!/usr/bin/env node
// CLI driver for the serve-mode harness. Two modes:
//   node cli.js --db <db> --file <query-file> [--uri ...] [--page] [--page-size] [--debug]
//       Spawn one --serve harness, init, run the file's script, print, shut down.
//   node cli.js --selftest [--uri ...]
//       Assert-based protocol check: ONE harness serves TWO runs (proving the
//       MongoClient is reused, not reconnected), plus a cancel smoke check.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const assert = require('assert');

const DEFAULT_URI = 'mongodb://localhost:27017';
const DEFAULT_PAGE = 0;
const DEFAULT_PAGE_SIZE = 10;
const SELFTEST_DB = 'mongolens_selftest';

function printUsage() {
  process.stderr.write(
    'Usage:\n' +
    '  node runner/cli.js --db <database> --file <query-file> ' +
    '[--uri mongodb://localhost:27017] [--page 0] [--page-size 10] [--debug]\n' +
    '  node runner/cli.js --selftest [--uri mongodb://localhost:27017]\n',
  );
}

function parseArgs(argv) {
  const args = {
    db: null, file: null, uri: DEFAULT_URI,
    page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE, debug: false, selftest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--db': args.db = argv[++i]; break;
      case '--file': args.file = argv[++i]; break;
      case '--uri': args.uri = argv[++i]; break;
      case '--page': args.page = parseInt(argv[++i], 10); break;
      case '--page-size': args.pageSize = parseInt(argv[++i], 10); break;
      case '--debug': args.debug = true; break;
      case '--selftest': args.selftest = true; break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

function spawnHarness(defaultDb, uri) {
  const harnessPath = path.resolve(__dirname, 'harness.js');
  return spawn(process.execPath, [harnessPath, '--serve', defaultDb], {
    env: {
      ...process.env,
      MONGO_URI: uri,
      NODE_PATH: path.join(os.homedir(), '.mongomacapp', 'runner', 'node_modules'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// Minimal client mirroring what the Rust executor does: one stdout reader, one
// stdin writer, responses demultiplexed by request id, a run resolved on its
// terminal __done. `readyCount` tallies `{__ready:true}` frames — the harness
// emits exactly one per successful connect, so a test can prove the connection
// was opened exactly once (and never reconnected) purely from the wire.
class HarnessClient {
  constructor(child, { onStderr } = {}) {
    this.child = child;
    this.pending = new Map();
    this.readyCount = 0;
    this.exited = false;
    child.on('exit', () => { this.exited = true; });
    this.readyPromise = new Promise((res, rej) => { this._readyRes = res; this._readyRej = rej; });
    readline.createInterface({ input: child.stdout }).on('line', (l) => this._onOut(l));
    readline.createInterface({ input: child.stderr }).on('line', (l) => {
      if (onStderr) onStderr(l);
    });
  }

  _onOut(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (_e) { return; }
    if (msg.__ready) { this.readyCount++; this._readyRes(true); return; }
    if (msg.fatal) { this._readyRej(new Error(msg.__error || 'fatal harness error')); return; }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    if (msg.__group !== undefined) entry.acc.groups.push(msg);
    else if (msg.__pagination) entry.acc.pagination = msg.__pagination;
    else if (msg.__log) entry.acc.logs.push(msg.__log.message);
    else if (msg.__error !== undefined) entry.acc.error = msg.__error;
    if (msg.__done) { this.pending.delete(msg.id); entry.resolve(entry.acc); }
  }

  init(auth) {
    this._send({ __init: auth ? { auth } : {} });
    return this.readyPromise;
  }

  // Register a pending run by id without sending — lets a caller batch several
  // request lines into a single stdin write (needed to deterministically queue
  // a second run behind the first before cancelling it).
  expect(id) {
    const acc = { id, groups: [], logs: [], pagination: null, error: null };
    return new Promise((resolve) => this.pending.set(id, { resolve, acc }));
  }

  run(req) {
    const p = this.expect(req.id);
    this._send({ ...req, action: 'run' });
    return p;
  }

  cancel(id) { this._send({ id, action: 'cancel' }); }
  shutdown() { this._send({ action: 'shutdown' }); }
  _send(obj) { this.child.stdin.write(JSON.stringify(obj) + '\n'); }
  sendBatch(objs) { this.child.stdin.write(objs.map((o) => JSON.stringify(o)).join('\n') + '\n'); }
}

function printResult(result, debug) {
  let lastGroupSize = 0;
  for (const g of result.groups) {
    const arr = Array.isArray(g.docs) ? g.docs : [g.docs];
    lastGroupSize = arr.length;
    process.stdout.write(`[group ${g.__group}] ${arr.length} docs\n`);
    for (const doc of arr) process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
  }
  if (result.pagination) {
    const { total, page, pageSize } = result.pagination;
    process.stdout.write(`\nPage ${page} · showing ${lastGroupSize} of ${total} · page size ${pageSize}\n`);
  }
  for (const message of result.logs) process.stdout.write(message + '\n');
  if (debug) process.stderr.write(`[debug] groups=${result.groups.length}\n`);
}

async function runHuman(args) {
  if (!args.db || !args.file) {
    process.stderr.write('Error: --db and --file are required\n');
    printUsage();
    process.exit(1);
  }
  const script = fs.readFileSync(args.file, 'utf8');
  const child = spawnHarness(args.db, args.uri);
  child.on('error', (err) => {
    process.stderr.write(`Failed to start harness: ${err.message}\n`);
    process.exit(1);
  });
  const client = new HarnessClient(child, {
    onStderr: (l) => { if (args.debug) process.stderr.write(l + '\n'); },
  });

  try {
    await client.init(null);
  } catch (err) {
    process.stderr.write(`Connect failed: ${err.message}\n`);
    process.exit(1);
  }

  const result = await client.run({
    id: 'cli-1', db: args.db, script, page: args.page, pageSize: args.pageSize,
  });
  printResult(result, args.debug);
  const exitCode = result.error ? 1 : 0;
  if (result.error) process.stderr.write(`Error: ${result.error}\n`);
  client.shutdown();
  child.on('close', () => process.exit(exitCode));
  // Fallback if the child lingers past shutdown.
  setTimeout(() => process.exit(exitCode), 3000).unref();
}

// The whole point of fix #1: ONE process + ONE MongoClient serving many runs.
// These asserts fail loudly if a future change reintroduces per-query spawn or
// reconnect, or breaks the per-request __done terminal / cancel framing.
async function runSelftest(args) {
  const script = 'db.mongolens_selftest_probe.find({})';
  const child = spawnHarness(SELFTEST_DB, args.uri);
  child.on('error', (err) => {
    process.stderr.write(`SELFTEST FAIL: could not spawn harness: ${err.message}\n`);
    process.exit(1);
  });
  const client = new HarnessClient(child);

  try {
    await client.init(null);
  } catch (err) {
    process.stderr.write(
      `SELFTEST FAIL: harness could not connect to Mongo at ${args.uri}: ${err.message}\n` +
      'Start a local mongod or pass --uri.\n',
    );
    process.exit(1);
  }

  // Two sequential runs over the SAME process.
  const r1 = await client.run({ id: 'r1', db: SELFTEST_DB, script, page: 0, pageSize: 5 });
  assert.strictEqual(r1.error, null, `run1 errored: ${r1.error}`);
  assert.ok(r1.groups.length >= 1, 'run1 produced no result group');

  const r2 = await client.run({ id: 'r2', db: SELFTEST_DB, script, page: 0, pageSize: 5 });
  assert.strictEqual(r2.error, null, `run2 errored: ${r2.error}`);
  assert.ok(r2.groups.length >= 1, 'run2 produced no result group');

  // Connection reuse: process stayed up, connected exactly once.
  assert.strictEqual(client.exited, false, 'harness process exited between runs — no reuse');
  assert.strictEqual(client.readyCount, 1, `expected exactly 1 connect (__ready), saw ${client.readyCount}`);

  // Cancel smoke: batch two runs + a cancel for the 2nd in ONE write so the 2nd
  // is guaranteed to be queued (or in-flight) when the cancel lands; either way
  // it must terminate as cancelled, and the 1st must still succeed.
  const pA = client.expect('cA');
  const pCancel = client.expect('cB');
  client.sendBatch([
    { id: 'cA', action: 'run', db: SELFTEST_DB, script, page: 0, pageSize: 5 },
    { id: 'cB', action: 'run', db: SELFTEST_DB, script, page: 0, pageSize: 5 },
    { id: 'cB', action: 'cancel' },
  ]);
  const [resA, resCancel] = await Promise.all([pA, pCancel]);
  assert.strictEqual(resA.error, null, `cancel-smoke run A errored: ${resA.error}`);
  assert.strictEqual(resCancel.error, 'cancelled', `expected cancelled terminal, got error=${resCancel.error}`);
  assert.strictEqual(client.readyCount, 1, 'cancel smoke must not have triggered a reconnect (__ready seen once)');

  process.stdout.write('SELFTEST PASS: 1 process, 1 connect, 2 runs reused it, cancel framed correctly\n');
  client.shutdown();
  child.on('close', () => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    runSelftest(args).catch((err) => {
      process.stderr.write(`SELFTEST FAIL: ${err.message}\n`);
      process.exit(1);
    });
    return;
  }
  runHuman(args).catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}

main();
