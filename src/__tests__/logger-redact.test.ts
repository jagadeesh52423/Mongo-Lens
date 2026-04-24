import { describe, it, expect } from 'vitest';
import { redactCtx } from '../services/logger/redact';

describe('redactCtx', () => {
  it('masks password in mongo URI', () => {
    const out = redactCtx({ uri: 'mongodb://user:secret@host/db' });
    expect(out.uri).toBe('mongodb://user:***@host/db');
  });

  it('leaves URI without password unchanged', () => {
    const out = redactCtx({ uri: 'mongodb://host/db' });
    expect(out.uri).toBe('mongodb://host/db');
  });

  it('masks password / secret / token / authorization fields', () => {
    const out = redactCtx({ password: 'p', secret: 's', token: 't', authorization: 'Bearer x' });
    expect(out).toEqual({ password: '***', secret: '***', token: '***', authorization: '***' });
  });

  it('truncates script field to 200 chars and appends hash', () => {
    const script = 'db.foo.find({ name: "alice" })' + 'x'.repeat(500);
    const out = redactCtx({ script });
    expect(typeof out.script).toBe('string');
    const s = out.script as string;
    expect(s.length).toBeLessThanOrEqual(200 + 80); // 200 + hash suffix
    expect(s.startsWith('db.foo.find')).toBe(true);
    expect(s).toMatch(/hash:[0-9a-f]{64}/);
  });

  it('returns [unparseable-uri] for invalid URIs', () => {
    const out = redactCtx({ uri: 'not a url' });
    expect(out.uri).toBe('[unparseable-uri]');
  });

  it('passes through unrelated fields', () => {
    const out = redactCtx({ connId: 'c_1', page: 3, nested: { ok: true } });
    expect(out).toEqual({ connId: 'c_1', page: 3, nested: { ok: true } });
  });
});
