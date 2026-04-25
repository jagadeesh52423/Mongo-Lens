const crypto = require('crypto');

const SENSITIVE = new Set(['password', 'secret', 'token', 'authorization']);
const URI_KEYS = new Set(['uri', 'mongoUri', 'connectionString']);

function redactUri(raw) {
  const i = raw.indexOf('://');
  if (i < 0) return '[unparseable-uri]';
  const scheme = raw.slice(0, i + 3);
  const rest = raw.slice(i + 3);
  const at = rest.indexOf('@');
  if (at < 0) {
    // No credentials — but still validate that `rest` has at least a host component
    // and contains no whitespace, otherwise treat as unparseable.
    if (!rest || /\s/.test(rest)) return '[unparseable-uri]';
    return raw;
  }
  const creds = rest.slice(0, at);
  const tail = rest.slice(at);
  const colon = creds.indexOf(':');
  if (colon < 0) return raw;
  return `${scheme}${creds.slice(0, colon)}:***${tail}`;
}

function redactScript(raw) {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  // Slice by Unicode code points (Array.from), not UTF-16 code units, so a
  // surrogate pair (e.g. an emoji) at the boundary isn't split into a lone
  // high surrogate. .length is still cheap and safe for the gate check —
  // only the slice path needs to be code-point aware.
  let head;
  if (raw.length > 200) {
    const points = Array.from(raw);
    head = (points.length > 200 ? points.slice(0, 200).join('') : raw) + '…';
  } else {
    head = raw;
  }
  return `${head} hash:${hash}`;
}

function redactCtx(ctx) {
  if (!ctx) return {};
  const out = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE.has(k)) out[k] = '***';
    else if (URI_KEYS.has(k) && typeof v === 'string') out[k] = redactUri(v);
    else if (k === 'script' && typeof v === 'string') out[k] = redactScript(v);
    else out[k] = v;
  }
  return out;
}

module.exports = { redactCtx, redactUri, redactScript };
