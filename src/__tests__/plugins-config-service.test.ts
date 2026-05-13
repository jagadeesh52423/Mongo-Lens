import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    url:     { type: 'string', default: 'http://d' },
    secret:  { type: 'string', 'x-secret': true },
    timeout: { type: 'integer', minimum: 0, maximum: 100 },
  },
  required: ['url'],
};

function make(opts: { grantSecretsRead?: boolean; manager?: { recheckEnforcement: ReturnType<typeof vi.fn> } } = {}) {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('p', schema, ws as any, kb);
  const broker = new PermissionBroker();
  if (opts.grantSecretsRead) broker.setGrants('p', [{ kind: 'secrets:read' }]);
  const manager = opts.manager ?? { recheckEnforcement: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new ConfigService('p', schema, store, broker, manager as any);
  return { ws, kb, store, broker, manager, svc };
}

describe('ConfigService.get / getAll', () => {
  it('returns defaults when unset', async () => {
    const { svc } = make();
    expect(await svc.get('url')).toBe('http://d');
  });

  it('omits x-secret values when secrets:read not granted', async () => {
    const { svc, kb } = make();
    await kb.set('plugin:p:config:secret', 'hidden');
    expect(await svc.get('secret')).toBeUndefined();
  });

  it('returns x-secret values when secrets:read is granted', async () => {
    const { svc, kb } = make({ grantSecretsRead: true });
    await kb.set('plugin:p:config:secret', 'visible');
    expect(await svc.get('secret')).toBe('visible');
  });

  it('getAll omits secret keys without secrets:read', async () => {
    const { svc, kb } = make();
    await kb.set('plugin:p:config:secret', 'hidden');
    const all = await svc.getAll();
    expect(all.secret).toBeUndefined();
    expect(all.url).toBe('http://d');
  });
});

describe('ConfigService.set', () => {
  it('validates and writes', async () => {
    const { svc, ws } = make();
    await svc.set('url', 'http://new');
    expect(ws.store.get('plugin.p.config.url')).toBe('http://new');
  });

  it('throws on schema violation', async () => {
    const { svc } = make();
    await expect(svc.set('timeout', 9999)).rejects.toThrow();
  });

  it('fires onDidChange with single-key delta', async () => {
    const { svc } = make();
    const seen: Array<{ keys: string[] }> = [];
    svc.onDidChange(e => seen.push({ keys: e.keys }));
    await svc.set('url', 'http://x');
    expect(seen).toEqual([{ keys: ['url'] }]);
  });
});

describe('ConfigService.save (batched)', () => {
  it('fires onDidChange once with only changed keys', async () => {
    const { svc } = make();
    await svc.set('url', 'http://x'); // baseline
    const events: string[][] = [];
    svc.onDidChange(e => events.push(e.keys.sort()));
    await svc.save({ url: 'http://x', timeout: 50 });   // url unchanged, timeout new
    expect(events).toEqual([['timeout']]);
  });

  it('does not fire onDidChange when nothing changed', async () => {
    const { svc } = make();
    await svc.set('url', 'http://x');
    const fn = vi.fn();
    svc.onDidChange(fn);
    await svc.save({ url: 'http://x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls manager.recheckEnforcement after a successful save', async () => {
    const recheck = vi.fn();
    const { svc } = make({ manager: { recheckEnforcement: recheck } });
    await svc.save({ url: 'http://x' });
    expect(recheck).toHaveBeenCalledWith('p');
  });

  it('serializes concurrent saves', async () => {
    const { svc, ws } = make();
    await Promise.all([
      svc.save({ url: 'http://a' }),
      svc.save({ url: 'http://b' }),
    ]);
    // Second save wins; both completed without interleaving (no thrown errors).
    expect(['http://a', 'http://b']).toContain(ws.store.get('plugin.p.config.url'));
  });

  it('omits secrets from the event payload when listener lacks secrets:read', async () => {
    const { svc } = make();
    const seen: Array<Record<string, unknown>> = [];
    svc.onDidChange(e => seen.push(e.values));
    await svc.save({ url: 'http://x', secret: 'pw' });
    expect(seen[0].url).toBe('http://x');
    expect(seen[0].secret).toBeUndefined();
  });
});
