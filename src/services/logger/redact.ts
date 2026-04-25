// Redaction helpers for log context.
//
// Applied in every adapter's write path so sensitive values never reach sinks
// (console, IPC, disk). Rules:
//   - Well-known sensitive keys (password/secret/token/authorization) → '***'
//   - URI-shaped keys (uri/mongoUri/connectionString) → password stripped
//   - `script` field → truncated + stable hash for correlation (not security)
//
// To add a new redaction rule: extend SENSITIVE_KEYS / URI_KEYS or add a
// dedicated branch in `redactCtx`. Keep the function sync so adapters stay
// non-async.

import type { LogCtx } from './types';

const SENSITIVE_KEYS = new Set(['password', 'secret', 'token', 'authorization']);
const URI_KEYS = new Set(['uri', 'mongoUri', 'connectionString']);
const SCRIPT_HEAD_LIMIT = 200;

function redactUri(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '[unparseable-uri]';
  }
}

// Non-crypto 256-bit correlation hash. Webview `crypto.subtle` is async, and
// redaction must stay sync, so we use four FNV-1a variants mixed into 64 hex
// chars. This is a correlation tag (dedup/grep), not a security hash.
function stableHash(input: string): string {
  const enc = new TextEncoder().encode(input);
  const seeds: bigint[] = [
    0xcbf29ce484222325n,
    0x100000001b3n,
    0x9e3779b97f4a7c15n,
    0x85ebca77c2b2ae63n,
  ];
  const mask = 0xffffffffffffffffn;
  const prime = 0x100000001b3n;
  const parts: string[] = [];
  for (const seed of seeds) {
    let h = seed;
    for (const b of enc) {
      h ^= BigInt(b);
      h = (h * prime) & mask;
    }
    parts.push(h.toString(16).padStart(16, '0'));
  }
  return parts.join('');
}

function redactScript(raw: string): string {
  // Slice on Unicode scalars (Array.from), not UTF-16 code units. A naive
  // `String.prototype.slice` can split a non-BMP surrogate pair (e.g., an
  // emoji at the boundary), producing a lone surrogate that corrupts the
  // record downstream. See review finding MINOR-6.
  const scalars = Array.from(raw);
  const head =
    scalars.length > SCRIPT_HEAD_LIMIT
      ? scalars.slice(0, SCRIPT_HEAD_LIMIT).join('') + '…'
      : raw;
  return `${head} hash:${stableHash(raw)}`;
}

export function redactCtx(ctx: LogCtx | undefined): LogCtx {
  if (!ctx) return {};
  const out: LogCtx = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '***';
    } else if (URI_KEYS.has(k) && typeof v === 'string') {
      out[k] = redactUri(v);
    } else if (k === 'script' && typeof v === 'string') {
      out[k] = redactScript(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
