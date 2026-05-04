import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

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

function spawnHarness(query, opts = {}) {
  const { uri, db, page, pageSize } = { ...DEFAULTS, ...opts };
  const tmpFile = path.join(os.tmpdir(), `harness-test-${randomBytes(8).toString('hex')}.js`);
  fs.writeFileSync(tmpFile, query);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [HARNESS_PATH, db, tmpFile],
      {
        env: {
          ...process.env,
          MONGO_URI: uri,
          MONGO_PAGE: String(page),
          MONGO_PAGE_SIZE: String(pageSize),
          NODE_PATH: MONGO_MODULES_DIR,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const cleanup = () => {
      try { fs.unlinkSync(tmpFile); } catch (_e) { /* ignore cleanup errors */ }
    };

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });

    child.on('close', (exitCode) => {
      cleanup();

      const groups = [];
      let pagination = null;
      let error = null;

      const parseLines = (text) => {
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch (_e) { continue; }
          if (msg.__error !== undefined) error = msg.__error;
          else if (msg.__group !== undefined) groups.push(msg);
          else if (msg.__pagination !== undefined) pagination = msg.__pagination;
        }
      };
      parseLines(stdout);
      parseLines(stderr);

      resolve({ groups, pagination, error, exitCode });
    });
  });
}

describe('harness integration tests', () => {
  beforeAll(() => {
    if (!mongodbInstalled) {
      throw new Error(
        'mongodb not found at ~/.mongomacapp/runner/node_modules — run the app once first to install it',
      );
    }
  });

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
    const printed = result.groups.find((g) => typeof g.docs[0] === 'string' && g.docs[0].startsWith('len='));
    expect(printed).toBeDefined();
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

  it('invalid syntax produces an error and non-zero exit code', async () => {
    const result = await spawnHarness('db.alert_tracker.find(INVALID');
    expect(result.error).not.toBeNull();
    expect(result.exitCode).toBe(1);
  });
});
