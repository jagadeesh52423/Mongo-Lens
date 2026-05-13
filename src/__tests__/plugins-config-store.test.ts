import { describe, it, expect } from 'vitest';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend, KeychainLockedError } from '../plugins/config/keychainBackend';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string)               { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    apiUrl:   { type: 'string', default: 'http://default' },
    password: { type: 'string', 'x-secret': true },
    timeout:  { type: 'integer', default: 30 },
  },
  required: ['apiUrl'],
};

function make() {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('acme.foo', schema, ws as any, kb);
  return { ws, kb, store };
}

describe('ConfigStore', () => {
  it('returns schema defaults when nothing stored', async () => {
    const { store } = make();
    expect(await store.getAll()).toEqual({ apiUrl: 'http://default', password: undefined, timeout: 30 });
  });

  it('routes x-secret writes to keychain', async () => {
    const { kb, store } = make();
    await store.setMany({ password: 'pw' });
    expect(await kb.get('plugin:acme.foo:config:password')).toBe('pw');
  });

  it('routes plain writes to workspace', async () => {
    const { ws, store } = make();
    await store.setMany({ apiUrl: 'http://x' });
    expect(ws.store.get('plugin.acme.foo.config.apiUrl')).toBe('http://x');
  });

  it('namespaces do not collide between config and secrets', async () => {
    const { kb } = make();
    await kb.set('plugin:acme.foo:secret:token', 'runtime');
    await kb.set('plugin:acme.foo:config:password', 'configured');
    expect(await kb.get('plugin:acme.foo:secret:token')).toBe('runtime');
    expect(await kb.get('plugin:acme.foo:config:password')).toBe('configured');
  });

  it('setMany is atomic when keychain throws', async () => {
    const { ws, store, kb } = make();
    kb.set = async () => { throw new KeychainLockedError(); };
    await expect(store.setMany({ apiUrl: 'http://x', password: 'pw' }))
      .rejects.toThrow(KeychainLockedError);
    expect(ws.store.get('plugin.acme.foo.config.apiUrl')).toBeUndefined();
  });

  it('setMany returns only keys that actually changed', async () => {
    const { store } = make();
    await store.setMany({ apiUrl: 'http://x' });
    const changed = await store.setMany({ apiUrl: 'http://x', timeout: 60 });
    expect(changed.sort()).toEqual(['timeout']);
  });

  it('returns stored value over default', async () => {
    const { store } = make();
    await store.setMany({ apiUrl: 'http://saved' });
    expect((await store.getAll()).apiUrl).toBe('http://saved');
  });
});
