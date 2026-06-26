/** Infer a coarse type label for a single value (best-effort, BSON-aware). */
export function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'Date';
  const t = typeof value;
  if (t === 'object') {
    // Common BSON-ish hints: plain objects with $oid/$date.
    const obj = value as Record<string, unknown>;
    if ('$oid' in obj) return 'ObjectId';
    if ('$date' in obj) return 'Date';
    return 'object';
  }
  return t;
}

/** Merge a sample of docs into `field -> sorted unique inferred types`. */
export function mergeSchema(docs: Array<Record<string, unknown>>): Record<string, string[]> {
  const acc: Record<string, Set<string>> = {};
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    for (const [k, v] of Object.entries(doc)) {
      (acc[k] ??= new Set<string>()).add(inferType(v));
    }
  }
  const out: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(acc)) out[k] = [...set].sort();
  return out;
}

/** Render a merged schema as prompt lines. Empty string when no fields. */
export function formatMergedSchema(schema: Record<string, string[]>): string {
  const keys = Object.keys(schema);
  if (keys.length === 0) return '';
  return keys.map((k) => `- ${k}: ${schema[k].join(' | ')}`).join('\n');
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  // BigInt is not JSON-serializable by default; downcast to string for the prompt.
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Best-effort JSON stringify that survives BSON-ish values (ObjectId, Date). */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, jsonReplacer, 2);
  } catch {
    return String(value);
  }
}
