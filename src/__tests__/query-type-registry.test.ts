import { describe, it, expect } from 'vitest';
import {
  QueryTypeRegistry,
  queryTypeRegistry,
  splitStatements,
  DEFAULT_OPERATIONS,
  DESTRUCTIVE_CATEGORIES,
  isPotentiallyDestructive,
} from '../services/query/QueryTypeRegistry';

describe('QueryTypeRegistry.classify — categories', () => {
  const registry = new QueryTypeRegistry();

  it('classifies find() as query', () => {
    expect(registry.classify('db.users.find({})')).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('classifies findOne() as query (not find)', () => {
    expect(registry.classify('db.users.findOne({})')).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it.each([
    ['insertOne', 'db.logs.insertOne({ x: 1 })'],
    ['insertMany', 'db.logs.insertMany([{ x: 1 }])'],
    ['updateOne', 'db.logs.updateOne({}, { $set: { y: 1 } })'],
    ['updateMany', 'db.logs.updateMany({}, { $set: { y: 1 } })'],
    ['deleteOne', 'db.logs.deleteOne({})'],
    ['deleteMany', 'db.logs.deleteMany({})'],
    ['replaceOne', 'db.logs.replaceOne({}, {})'],
    ['findOneAndUpdate', 'db.logs.findOneAndUpdate({}, {})'],
    ['findOneAndReplace', 'db.logs.findOneAndReplace({}, {})'],
    ['findOneAndDelete', 'db.logs.findOneAndDelete({})'],
    ['bulkWrite', 'db.logs.bulkWrite([])'],
  ])('classifies %s as mutation', (_op, script) => {
    expect(registry.classify(script)).toEqual({
      category: 'mutation',
      collection: 'logs',
    });
  });

  it.each([
    ['aggregate', 'db.orders.aggregate([])'],
    ['distinct', 'db.orders.distinct("status")'],
    ['countDocuments', 'db.orders.countDocuments({})'],
    ['estimatedDocumentCount', 'db.orders.estimatedDocumentCount()'],
  ])('classifies %s as transform', (_op, script) => {
    expect(registry.classify(script)).toEqual({
      category: 'transform',
      collection: 'orders',
    });
  });

  it.each([
    ['createIndex', 'db.items.createIndex({ a: 1 })'],
    ['createIndexes', 'db.items.createIndexes([{ key: { a: 1 }, name: "a_1" }])'],
    ['dropIndex', 'db.items.dropIndex("a_1")'],
    ['dropIndexes', 'db.items.dropIndexes()'],
    ['listIndexes', 'db.items.listIndexes()'],
    ['drop', 'db.items.drop()'],
    ['rename', 'db.items.rename("items2")'],
    ['stats', 'db.items.stats()'],
  ])('classifies %s as maintenance', (_op, script) => {
    expect(registry.classify(script)).toEqual({
      category: 'maintenance',
      collection: 'items',
    });
  });

  it('classifies watch() as stream', () => {
    expect(registry.classify('db.events.watch()')).toEqual({
      category: 'stream',
      collection: 'events',
    });
  });
});

describe('QueryTypeRegistry.classify — collection extraction', () => {
  const registry = new QueryTypeRegistry();

  it('extracts from db.getCollection("name") double-quoted', () => {
    expect(registry.classify('db.getCollection("users").find({})')).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('extracts from db.getCollection(\'name\') single-quoted', () => {
    expect(registry.classify("db.getCollection('users').find({})")).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('extracts from db.name identifier form', () => {
    expect(registry.classify('db.users.find({})').collection).toBe('users');
  });

  it('extracts from db["name"] bracket-string form', () => {
    expect(registry.classify('db["users"].find({})')).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('returns null collection for db[variable] dynamic form', () => {
    expect(
      registry.classify('const col = "users"; db[col].find({});'),
    ).toEqual({ category: 'query', collection: null });
  });

  it('returns null collection for db.getCollection(variable)', () => {
    expect(
      registry.classify('const col = "users"; db.getCollection(col).find({});'),
    ).toEqual({ category: 'query', collection: null });
  });
});

describe('QueryTypeRegistry.classify — bracket-notation operations', () => {
  const registry = new QueryTypeRegistry();

  it.each([
    ['db.items["drop"]()', 'maintenance', 'items'],
    ["db.items['drop']()", 'maintenance', 'items'],
    ['db.logs["deleteMany"]({})', 'mutation', 'logs'],
    ["db.logs['insertOne']({ x: 1 })", 'mutation', 'logs'],
    ['db.users["find"]({})', 'query', 'users'],
  ])('classifies %s as %s on %s', (script, category, collection) => {
    expect(registry.classify(script)).toEqual({ category, collection });
  });

  it('classifies bracket op on a bracket collection: db["c"]["deleteMany"]()', () => {
    expect(registry.classify('db["c"]["deleteMany"]({})')).toEqual({
      category: 'mutation',
      collection: 'c',
    });
  });

  it('classifies bracket op on getCollection: db.getCollection("c")["drop"]()', () => {
    expect(registry.classify('db.getCollection("c")["drop"]()')).toEqual({
      category: 'maintenance',
      collection: 'c',
    });
  });

  it('ignores a bracket op name that lives inside a string literal', () => {
    expect(registry.classify('const s = "db.x[\'drop\']()"; print(s);')).toEqual({
      category: null,
      collection: null,
    });
  });

  it('ignores a bracket op on a non-db object', () => {
    expect(registry.classify("[1,2,3]['find'](x => x > 1)")).toEqual({
      category: null,
      collection: null,
    });
  });
});

describe('isPotentiallyDestructive — fail-safe verdict', () => {
  it('treats writes/structural ops as destructive', () => {
    expect(isPotentiallyDestructive('mutation')).toBe(true);
    expect(isPotentiallyDestructive('maintenance')).toBe(true);
  });

  it('treats reads and streams as non-destructive', () => {
    expect(isPotentiallyDestructive('query')).toBe(false);
    expect(isPotentiallyDestructive('transform')).toBe(false);
    expect(isPotentiallyDestructive('stream')).toBe(false);
  });

  it('treats UNCLASSIFIABLE input as destructive (fail-safe)', () => {
    expect(isPotentiallyDestructive(null)).toBe(true);
    expect(isPotentiallyDestructive(undefined)).toBe(true);
    expect(isPotentiallyDestructive({ category: null, collection: null })).toBe(true);
  });

  it('accepts a classification object', () => {
    expect(isPotentiallyDestructive({ category: 'mutation', collection: 'x' })).toBe(true);
    expect(isPotentiallyDestructive({ category: 'query', collection: 'x' })).toBe(false);
  });

  it('DESTRUCTIVE_CATEGORIES contains exactly the write/structural categories', () => {
    expect(DESTRUCTIVE_CATEGORIES).toEqual(new Set(['mutation', 'maintenance']));
  });

  it('every unclassifiable bracket alias is reported destructive', () => {
    const registry = new QueryTypeRegistry();
    // An aliased op the static classifier can't recognize -> null -> destructive.
    expect(isPotentiallyDestructive(registry.classify('db.coll.someAlias()'))).toBe(true);
  });
});

describe('QueryTypeRegistry.classify — null cases', () => {
  const registry = new QueryTypeRegistry();

  it('returns null for empty script', () => {
    expect(registry.classify('')).toEqual({ category: null, collection: null });
  });

  it('returns null for whitespace-only script', () => {
    expect(registry.classify('   \n\n   ')).toEqual({
      category: null,
      collection: null,
    });
  });

  it('returns null for comment-only line', () => {
    expect(registry.classify('// db.users.find({})')).toEqual({
      category: null,
      collection: null,
    });
  });

  it('returns null for block-comment-only script', () => {
    expect(registry.classify('/* db.users.find({}) */')).toEqual({
      category: null,
      collection: null,
    });
  });

  it('returns null when find() is called on a non-db object', () => {
    expect(registry.classify('[1,2,3].find(x => x > 1)')).toEqual({
      category: null,
      collection: null,
    });
  });

  it('returns null for string literal that contains db.users.find(...)', () => {
    expect(
      registry.classify('const s = "db.users.find({})"; console.log(s);'),
    ).toEqual({ category: null, collection: null });
  });

  it('returns null for non-string input', () => {
    // @ts-expect-error — verifying runtime guard
    expect(registry.classify(null)).toEqual({
      category: null,
      collection: null,
    });
  });
});

describe('QueryTypeRegistry.classify — chained and mixed', () => {
  const registry = new QueryTypeRegistry();

  it('picks the outer (first) operation in chained calls', () => {
    const script =
      'db.users.find({}).forEach(doc => { db.audit.insertOne(doc); });';
    expect(registry.classify(script)).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('picks the first when two db ops appear separated by comment', () => {
    const script = [
      '// leading comment',
      'db.users.find({})',
      '// later',
      'db.orders.aggregate([])',
    ].join('\n');
    expect(registry.classify(script)).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('classifies chained find().sort().limit() as query (sort/limit are not in registry)', () => {
    expect(registry.classify('db.users.find({}).sort({ name: 1 }).limit(5)')).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('ignores operation tokens appearing inside string literals', () => {
    const script = 'const x = "db.users.find({})"; db.audit.insertOne({x: x});';
    expect(registry.classify(script)).toEqual({
      category: 'mutation',
      collection: 'audit',
    });
  });
});

describe('splitStatements', () => {
  it('splits by top-level semicolons', () => {
    expect(splitStatements('db.a.find({}); db.b.find({});')).toHaveLength(2);
  });

  it('does not split on semicolons inside strings', () => {
    const script = 'db.a.insertOne({ s: "x;y;z" });';
    expect(splitStatements(script)).toHaveLength(1);
  });

  it('does not split on semicolons inside nested blocks', () => {
    const script = 'db.a.find({}).forEach(d => { log(d); log(d); });';
    expect(splitStatements(script)).toHaveLength(1);
  });

  it('drops whitespace-only trailing statements', () => {
    expect(splitStatements('db.a.find({});  \n  ')).toHaveLength(1);
  });

  it('returns empty array for empty script', () => {
    expect(splitStatements('')).toEqual([]);
  });

  it('splits then each statement classifies to its own operation', () => {
    const script = [
      'db.users.find({});',
      'db.orders.aggregate([]);',
      'db.audit.insertOne({ e: "x" });',
    ].join('\n');
    const registry = new QueryTypeRegistry();
    const classes = splitStatements(script).map((s) => registry.classify(s));
    expect(classes).toEqual([
      { category: 'query', collection: 'users' },
      { category: 'transform', collection: 'orders' },
      { category: 'mutation', collection: 'audit' },
    ]);
  });
});

describe('QueryTypeRegistry extensibility', () => {
  it('exports a module-level singleton', () => {
    expect(queryTypeRegistry).toBeInstanceOf(QueryTypeRegistry);
    expect(queryTypeRegistry.classify('db.users.find({})')).toEqual({
      category: 'query',
      collection: 'users',
    });
  });

  it('exposes DEFAULT_OPERATIONS with stable categories', () => {
    const findOp = DEFAULT_OPERATIONS.find((op) => op.category === 'query');
    expect(findOp).toBeDefined();
    expect(DEFAULT_OPERATIONS.length).toBeGreaterThan(10);
  });

  it('register() adds new operations that classify() picks up', () => {
    const registry = new QueryTypeRegistry([]);
    expect(registry.classify('db.users.find({})')).toEqual({
      category: null,
      collection: null,
    });
    registry.register({
      pattern: /\.find(?![A-Za-z0-9_$])\s*\(/,
      category: 'query',
    });
    expect(registry.classify('db.users.find({})')).toEqual({
      category: 'query',
      collection: 'users',
    });
  });
});
