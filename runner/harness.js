const { MongoClient } = require('mongodb');
const fs = require('fs');

const uri = process.env.MONGO_URI;
if (!uri) {
  process.stderr.write(JSON.stringify({ __error: 'MONGO_URI env var is required' }) + '\n');
  process.exit(1);
}
const [dbName, scriptPath] = process.argv.slice(2);
const userScript = fs.readFileSync(scriptPath, 'utf8');

let groupIndex = 0;

function emitGroup(docs) {
  const arr = Array.isArray(docs) ? docs : [docs];
  const safe = JSON.parse(JSON.stringify(arr, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && v._bsontype === 'ObjectId') return v.toString();
    return v;
  }));
  process.stdout.write(
    JSON.stringify({ __group: groupIndex++, docs: safe }) + '\n',
  );
}

function makeCollectionProxy(col) {
  const autoCapture = new Set([
    'find', 'aggregate', 'insertOne', 'insertMany',
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
    'replaceOne', 'findOne', 'countDocuments', 'distinct',
  ]);
  return new Proxy(col, {
    get(target, prop) {
      if (typeof prop === 'string' && autoCapture.has(prop)) {
        return (...args) => {
          const op = target[prop](...args);
          if (op && typeof op.toArray === 'function') {
            return op.toArray().then((docs) => { emitGroup(docs); return docs; });
          }
          return Promise.resolve(op).then((r) => {
            emitGroup(r === undefined ? null : r);
            return r;
          });
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

function wrapDb(raw) {
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'collection') {
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
  const client = new MongoClient(uri);
  await client.connect();
  const db = wrapDb(client.db(dbName));
  try {
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFn('db', 'print', userScript);
    const print = (v) => emitGroup(v);
    await fn(db, print);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({ __error: err.message, line: extractLine(err) }) + '\n',
    );
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  process.stderr.write(JSON.stringify({ __error: err.message }) + '\n');
  process.exit(1);
});
