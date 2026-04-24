import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IpcLogger, type InvokeFn } from '../services/logger/IpcLogger';

describe('IpcLogger', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let logger: IpcLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset module-level static state that persists across tests.
    IpcLogger.resetForTests();
    invoke = vi.fn().mockResolvedValue(undefined);
    logger = new IpcLogger('root', 'debug', invoke as unknown as InvokeFn);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('buffers records and flushes at 20-record threshold', () => {
    for (let i = 0; i < 19; i++) logger.info(`m${i}`);
    expect(invoke).not.toHaveBeenCalled();
    logger.info('m19'); // 20th record
    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invoke.mock.calls[0];
    expect(cmd).toBe('log_write');
    expect((payload as { records: unknown[] }).records).toHaveLength(20);
  });

  it('flushes on 100ms timer when under threshold', () => {
    logger.info('one');
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((invoke.mock.calls[0][1] as { records: unknown[] }).records).toHaveLength(1);
  });

  it('suppresses records below threshold', () => {
    const l = new IpcLogger('root', 'warn', invoke as unknown as InvokeFn);
    l.debug('x');
    l.info('x');
    l.warn('y');
    vi.advanceTimersByTime(200);
    expect(invoke).toHaveBeenCalledTimes(1);
    const rec = (invoke.mock.calls[0][1] as { records: Array<{ level: string }> }).records;
    expect(rec.map((r) => r.level)).toEqual(['warn']);
  });

  it('continues silently when invoke throws (logs one warn to console)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error('ipc down'));
    logger.info('x');
    // advanceTimersByTimeAsync runs pending timers AND awaits microtasks so the
    // rejected-promise `.catch(...)` handler has a chance to run.
    await vi.advanceTimersByTimeAsync(100);
    expect(warnSpy).toHaveBeenCalled();
    // subsequent writes should still not throw
    logger.info('after-failure');
    await vi.advanceTimersByTimeAsync(100);
  });

  it('child merges bindings', () => {
    const c = logger.child({ runId: 'r1' });
    c.info('go', { extra: 2 });
    vi.advanceTimersByTime(100);
    const payload = invoke.mock.calls[0][1] as {
      records: Array<{ ctx: Record<string, unknown>; runId?: string }>;
    };
    expect(payload.records[0].ctx).toMatchObject({ runId: 'r1', extra: 2 });
    expect(payload.records[0].runId).toBe('r1');
  });

  it('redacts uri password in ctx', () => {
    logger.info('conn', { uri: 'mongodb://u:p@h/d' });
    vi.advanceTimersByTime(100);
    const r = (invoke.mock.calls[0][1] as { records: Array<{ ctx: Record<string, unknown> }> })
      .records[0];
    expect(r.ctx.uri).toBe('mongodb://u:***@h/d');
  });
});
