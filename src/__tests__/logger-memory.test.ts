import { describe, it, expect } from 'vitest';
import { MemoryLogger } from '../services/logger/MemoryLogger';
import { NoopLogger } from '../services/logger/NoopLogger';

describe('MemoryLogger', () => {
  it('records all levels with message and ctx', () => {
    const log = new MemoryLogger('root');
    log.error('boom', { code: 1 });
    log.warn('careful', {});
    log.info('hello', { a: 1 });
    log.debug('deep', { b: 2 });
    expect(log.records).toHaveLength(4);
    expect(log.records[0]).toMatchObject({
      level: 'error',
      msg: 'boom',
      ctx: { code: 1 },
      logger: 'root',
    });
    expect(log.records[2]).toMatchObject({
      level: 'info',
      msg: 'hello',
      ctx: { a: 1 },
      logger: 'root',
    });
  });

  it('child merges bindings into every ctx', () => {
    const root = new MemoryLogger('root');
    const child = root.child({ runId: 'r1', tabId: 't1' });
    child.info('go', { extra: 9 });
    expect(root.records).toHaveLength(1);
    expect(root.records[0].ctx).toEqual({ runId: 'r1', tabId: 't1', extra: 9 });
    expect(root.records[0].runId).toBe('r1');
  });

  it('nested child preserves parent bindings', () => {
    const root = new MemoryLogger('root');
    root.child({ a: 1 }).child({ b: 2 }).info('x', { c: 3 });
    expect(root.records[0].ctx).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('applies redaction to ctx (uri password masked)', () => {
    const log = new MemoryLogger('root');
    log.info('conn', { uri: 'mongodb://u:p@h/d' });
    expect(log.records[0].ctx.uri).toBe('mongodb://u:***@h/d');
  });
});

describe('NoopLogger', () => {
  it('accepts all calls without throwing and returns itself from child', () => {
    const log = new NoopLogger();
    expect(() => log.error('x')).not.toThrow();
    expect(log.child({ a: 1 })).toBeInstanceOf(NoopLogger);
  });
});
