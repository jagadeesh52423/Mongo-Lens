import { createPluginLogger } from '../plugins/api/logger';

describe('plugin logger', () => {
  it('tags every record with pluginId and forwards to underlying logger', () => {
    const calls: { level: string; msg: string; ctx?: Record<string, unknown> }[] = [];
    const underlying = {
      info:  (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'info', msg, ctx }),
      warn:  (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'warn', msg, ctx }),
      error: (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'error', msg, ctx }),
      debug: (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'debug', msg, ctx }),
    };
    const logger = createPluginLogger('acme.foo', underlying);
    logger.info('hello', { x: 1 });
    logger.error('boom');
    expect(calls).toEqual([
      { level: 'info',  msg: 'hello', ctx: { x: 1, pluginId: 'acme.foo' } },
      { level: 'error', msg: 'boom',  ctx: { pluginId: 'acme.foo' } },
    ]);
  });
});
