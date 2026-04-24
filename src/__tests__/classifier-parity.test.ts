import { describe, it, expect } from 'vitest';
import {
  QueryTypeRegistry,
  splitStatements as tsSplit,
  DEFAULT_OPERATIONS as TS_DEFAULT_OPERATIONS,
} from '../services/query/QueryTypeRegistry';
import * as cjsClassifier from '../../runner/query-classifier';

/**
 * Parity tests: the TS `QueryTypeRegistry` and the runner's CJS
 * `query-classifier.js` must produce identical classifications for the same
 * input. Currently the TS side is a thin wrapper over the CJS module — this
 * test is a contract guard so any future attempt to fork the two
 * implementations fails loudly instead of silently skewing results between
 * the runner (backend) and the TS UI.
 *
 * If this ever fails because the TS side evolved independently, the fix is
 * to keep both in lockstep (or to delete the duplicate and keep only the CJS
 * module) — not to edit this test.
 */

const FIXTURES: { label: string; script: string }[] = [
  { label: 'query / db.X', script: 'db.users.find({})' },
  { label: 'query / findOne', script: 'db.users.findOne({ active: true })' },
  { label: 'query / getCollection static', script: 'db.getCollection("users").find({})' },
  { label: 'query / getCollection dynamic', script: 'const c = "users"; db.getCollection(c).find({});' },
  { label: 'query / bracket static', script: 'db["users"].find({})' },
  { label: 'query / bracket dynamic', script: 'const c = "users"; db[c].find({});' },
  { label: 'mutation / insertOne', script: 'db.audit.insertOne({ event: "x" })' },
  { label: 'mutation / bulkWrite', script: 'db.audit.bulkWrite([])' },
  { label: 'mutation / findOneAndUpdate', script: 'db.users.findOneAndUpdate({}, {})' },
  { label: 'transform / aggregate', script: 'db.orders.aggregate([{ $group: { _id: "$status" } }])' },
  { label: 'transform / distinct', script: 'db.orders.distinct("status")' },
  { label: 'transform / countDocuments', script: 'db.orders.countDocuments({})' },
  { label: 'maintenance / createIndex', script: 'db.items.createIndex({ a: 1 })' },
  { label: 'maintenance / listIndexes', script: 'db.items.listIndexes()' },
  { label: 'maintenance / drop', script: 'db.items.drop()' },
  { label: 'stream / watch', script: 'db.events.watch()' },
  { label: 'chain / find then forEach insertOne', script: 'db.users.find({}).forEach(d => { db.audit.insertOne(d); });' },
  { label: 'string literal masks match', script: 'const s = "db.users.find({})"; db.audit.insertOne({ s });' },
  { label: 'line comment masks match', script: '// db.users.find({})\ndb.audit.insertOne({})' },
  { label: 'block comment masks match', script: '/* db.users.find({}) */\ndb.audit.insertOne({})' },
  { label: 'null / empty', script: '' },
  { label: 'null / whitespace', script: '   \n\n   ' },
  { label: 'null / comment-only', script: '// db.users.find({})' },
  { label: 'null / non-db array find', script: '[1,2,3].find(x => x > 1)' },
];

describe('classifier parity — TS QueryTypeRegistry ↔ CJS query-classifier', () => {
  const tsRegistry = new QueryTypeRegistry();

  it.each(FIXTURES)('classify() agrees for $label', ({ script }) => {
    const tsResult = tsRegistry.classify(script);
    const cjsResult = cjsClassifier.classify(script);
    expect(tsResult).toEqual(cjsResult);
  });

  it('DEFAULT_OPERATIONS is the same array reference', () => {
    // The TS wrapper re-exports the CJS DEFAULT_OPERATIONS — not a copy.
    // Proving reference equality guarantees no one can drift without
    // someone also touching both files.
    expect(TS_DEFAULT_OPERATIONS).toBe(cjsClassifier.DEFAULT_OPERATIONS);
  });

  it('DEFAULT_OPERATIONS covers every expected category', () => {
    const categories = new Set(TS_DEFAULT_OPERATIONS.map((op) => op.category));
    expect(categories).toEqual(
      new Set(['query', 'mutation', 'transform', 'maintenance', 'stream']),
    );
  });

  it('splitStatements agrees across TS and CJS', () => {
    const script = [
      'db.a.find({});',
      'db.b.insertOne({ s: "x;y" });',
      'db.c.find({}).forEach(d => { log(d); log(d); });',
      '// trailing comment',
    ].join('\n');
    expect(tsSplit(script)).toEqual(cjsClassifier.splitStatements(script));
  });
});
