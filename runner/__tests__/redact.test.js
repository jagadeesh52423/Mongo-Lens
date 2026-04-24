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
});
