/**
 * Shared MongoDB-script classifier used by BOTH the runner harness (Node,
 * CommonJS) and the TypeScript QueryTypeRegistry (Vite bundle). This is the
 * single source of truth — neither side maintains its own copy of
 * DEFAULT_OPERATIONS, classify, or splitStatements.
 *
 * Deployment: both `harness.js` and `query-classifier.js` must be copied to
 * `~/.mongomacapp/runner/` together; `harness.js` requires this module at
 * runtime via `./query-classifier.js`.
 *
 * Extensibility: build a new `OperationDef` and either extend DEFAULT_OPERATIONS
 * or pass a custom array into `classify()`. No other code needs to change.
 */

/**
 * @typedef {'query' | 'mutation' | 'transform' | 'maintenance' | 'stream'} QueryCategory
 * @typedef {{ pattern: RegExp, category: QueryCategory }} OperationDef
 * @typedef {{ category: QueryCategory | null, collection: string | null }} QueryClassification
 */

function opPattern(name) {
  return new RegExp(`\\.${name}(?![A-Za-z0-9_$])\\s*\\(`);
}

/** @type {readonly OperationDef[]} */
const DEFAULT_OPERATIONS = Object.freeze([
  // query — results map 1:1 to source documents; F4 Edit Record applies.
  Object.freeze({ pattern: opPattern('find'), category: 'query' }),
  Object.freeze({ pattern: opPattern('findOne'), category: 'query' }),

  // mutation — modifies documents; results are write acks, not editable.
  Object.freeze({ pattern: opPattern('insertOne'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('insertMany'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('updateOne'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('updateMany'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('deleteOne'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('deleteMany'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('replaceOne'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('findOneAndUpdate'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('findOneAndReplace'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('findOneAndDelete'), category: 'mutation' }),
  Object.freeze({ pattern: opPattern('bulkWrite'), category: 'mutation' }),

  // transform — computed/aggregated results; not editable originals.
  Object.freeze({ pattern: opPattern('aggregate'), category: 'transform' }),
  Object.freeze({ pattern: opPattern('distinct'), category: 'transform' }),
  Object.freeze({ pattern: opPattern('countDocuments'), category: 'transform' }),
  Object.freeze({ pattern: opPattern('estimatedDocumentCount'), category: 'transform' }),

  // maintenance — metadata operations on the collection itself.
  Object.freeze({ pattern: opPattern('createIndex'), category: 'maintenance' }),
  Object.freeze({ pattern: opPattern('createIndexes'), category: 'maintenance' }),
  Object.freeze({ pattern: opPattern('dropIndex'), category: 'maintenance' }),
  Object.freeze({ pattern: opPattern('dropIndexes'), category: 'maintenance' }),
  Object.freeze({ pattern: opPattern('listIndexes'), category: 'maintenance' }),
  Object.freeze({ pattern: opPattern('drop'), category: 'maintenance' }),
  Object.freeze({ pattern: opPattern('rename'), category: 'maintenance' }),
  Object.freeze({ pattern: opPattern('stats'), category: 'maintenance' }),

  // stream — change stream; not an editable result set.
  Object.freeze({ pattern: opPattern('watch'), category: 'stream' }),
]);

/**
 * Strip comment bodies and string contents while preserving their positions.
 * Lets us run pattern matching without false positives inside strings or
 * comments, and still use the original script text for collection extraction
 * via positional slicing.
 */
function stripCommentsAndStrings(script) {
  let out = '';
  let i = 0;
  const n = script.length;
  while (i < n) {
    const ch = script[i];
    const nextCh = script[i + 1];

    if (ch === '/' && nextCh === '/') {
      while (i < n && script[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && nextCh === '*') {
      out += '  '; i += 2;
      while (i < n && !(script[i] === '*' && script[i + 1] === '/')) {
        out += script[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n && script[i] !== quote) {
        if (script[i] === '\\' && i + 1 < n) { out += '  '; i += 2; }
        else { out += script[i] === '\n' ? '\n' : ' '; i++; }
      }
      if (i < n) { out += quote; i++; }
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Extract collection target from the script text immediately preceding an
 * operation match. Returns `{ hasDbPrefix, name }`.
 *
 * Supported forms:
 *   - db.getCollection("name") / db.getCollection('name')    → static name
 *   - db.getCollection(variable)                              → dynamic (null name)
 *   - db["name"] / db['name']                                 → static name
 *   - db[variable]                                            → dynamic (null name)
 *   - db.name                                                 → static name
 */
function extractCollection(before) {
  const getCollStatic = /\bdb\s*\.\s*getCollection\s*\(\s*(['"])([^'"]*)\1\s*\)\s*$/;
  const m1 = before.match(getCollStatic);
  if (m1) return { hasDbPrefix: true, name: m1[2] };

  const getCollDyn = /\bdb\s*\.\s*getCollection\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*$/;
  if (getCollDyn.test(before)) return { hasDbPrefix: true, name: null };

  const bracketStatic = /\bdb\s*\[\s*(['"])([^'"]*)\1\s*\]\s*$/;
  const m2 = before.match(bracketStatic);
  if (m2) return { hasDbPrefix: true, name: m2[2] };

  const bracketDyn = /\bdb\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*$/;
  if (bracketDyn.test(before)) return { hasDbPrefix: true, name: null };

  const dotIdent = /\bdb\s*\.\s*([A-Za-z_$][\w$]*)\s*$/;
  const m3 = before.match(dotIdent);
  if (m3) return { hasDbPrefix: true, name: m3[1] };

  return { hasDbPrefix: false, name: null };
}

/**
 * Classify a script (or single statement) against the given operation registry.
 * Returns the earliest matched operation's category plus the statically-
 * resolvable collection (or null when dynamic or absent).
 *
 * @param {string} script
 * @param {readonly OperationDef[]} [operations=DEFAULT_OPERATIONS]
 * @returns {QueryClassification}
 */
function classify(script, operations) {
  if (!script || typeof script !== 'string') return { category: null, collection: null };
  const ops = operations || DEFAULT_OPERATIONS;
  const cleaned = stripCommentsAndStrings(script);

  let earliestIndex = Infinity;
  let earliestCategory = null;
  let earliestBefore = '';

  for (const op of ops) {
    const re = new RegExp(op.pattern.source, op.pattern.flags.replace('g', ''));
    const match = re.exec(cleaned);
    if (!match || match.index >= earliestIndex) continue;

    const before = script.slice(0, match.index);
    const ctx = extractCollection(before);
    if (!ctx.hasDbPrefix) continue;

    earliestIndex = match.index;
    earliestCategory = op.category;
    earliestBefore = before;
  }

  if (earliestCategory === null) return { category: null, collection: null };

  const { name } = extractCollection(earliestBefore);
  return { category: earliestCategory, collection: name };
}

/**
 * Split a script into top-level statements by `;`, respecting strings,
 * template literals, comments, and brace/paren/bracket nesting. Whitespace-
 * only statements are dropped.
 *
 * @param {string} script
 * @returns {string[]}
 */
function splitStatements(script) {
  const statements = [];
  let current = '';
  let depth = 0;
  let i = 0;
  const n = script.length;
  while (i < n) {
    const ch = script[i];
    const nextCh = script[i + 1];

    if (ch === '/' && nextCh === '/') {
      while (i < n && script[i] !== '\n') current += script[i++];
      continue;
    }
    if (ch === '/' && nextCh === '*') {
      current += script[i++]; current += script[i++];
      while (i < n && !(script[i] === '*' && script[i + 1] === '/')) current += script[i++];
      if (i < n) { current += script[i++]; current += script[i++]; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      current += script[i++];
      while (i < n && script[i] !== quote) {
        if (script[i] === '\\' && i + 1 < n) { current += script[i++]; current += script[i++]; continue; }
        current += script[i++];
      }
      if (i < n) current += script[i++];
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      if (current.trim()) statements.push(current);
      current = '';
      i++;
      continue;
    }
    current += script[i++];
  }
  if (current.trim()) statements.push(current);
  return statements;
}

module.exports = {
  DEFAULT_OPERATIONS,
  classify,
  splitStatements,
};
