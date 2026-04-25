import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const { redactCtx } = require(path.resolve(__dirname, '..', 'redact.js'));

describe('runner redactCtx', () => {
  it('masks mongo uri password', () => {
    expect(redactCtx({ uri: 'mongodb://u:secret@h/d' }).uri).toBe('mongodb://u:***@h/d');
  });

  it('returns [unparseable-uri] for junk', () => {
    expect(redactCtx({ uri: 'not a uri' }).uri).toBe('[unparseable-uri]');
  });

  it('masks password/secret/token/authorization', () => {
    expect(redactCtx({ password: 'p', secret: 's', token: 't', authorization: 'a' }))
      .toEqual({ password: '***', secret: '***', token: '***', authorization: '***' });
  });

  it('truncates + hashes script', () => {
    const script = 'a'.repeat(500);
    const out = redactCtx({ script }).script;
    expect(out).toMatch(/hash:[0-9a-f]{64}/);
    expect(out.length).toBeLessThan(500);
  });

  it('passes through unrelated fields', () => {
    expect(redactCtx({ connId: 'c', page: 3 })).toEqual({ connId: 'c', page: 3 });
  });

  // MINOR-6: redactScript truncates by code points, not UTF-16 units, so a
  // surrogate-paired emoji at the boundary is not split into a lone surrogate.
  it('does not split surrogate pairs when truncating script', () => {
    // 199 ASCII chars then a 4-byte (surrogate-paired) emoji at index 199-200.
    // Naive .slice(0, 200) would keep the high surrogate but drop the low.
    const script = 'a'.repeat(199) + '😀' + 'b'.repeat(300);
    const out = redactCtx({ script }).script;
    // No lone surrogates in the truncated head (validates as well-formed UTF-16).
    expect(out).toMatch(/hash:[0-9a-f]{64}/);
    // Encoding round-trip would replace lone surrogates with U+FFFD; verify
    // the head stays clean.
    const head = out.split(' hash:')[0].replace(/…$/, '');
    expect(Buffer.from(head, 'utf8').toString('utf8')).toBe(head);
  });
});
