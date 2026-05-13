import { describe, it, expect, vi } from 'vitest';
import { createMongolens } from '../plugins/api/createMongolens';
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { createRegistrySet } from '../plugins/registries';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'P',
  properties: { url: { type: 'string', default: 'http://d' } },
};

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('mongolens.config (createMongolens)', () => {
  it('exposes get/set/getAll/onDidChange', async () => {
    const ws = new FakeWorkspace();
    const kb = new InMemoryKeychainBackend();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new ConfigStore('acme.p', schema, ws as any, kb);
    const broker = new PermissionBroker();
    const config = new ConfigService('acme.p', schema, store, broker,
      { recheckEnforcement: vi.fn() });

    const ml = createMongolens({
      pluginId: 'acme.p',
      registries: createRegistrySet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: { config } as any,
      logger: silentLogger(),
      manifest: { id: 'acme.p', name: 'P', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'm.js' },
    });

    expect(typeof ml.config.get).toBe('function');
    expect(typeof ml.config.set).toBe('function');
    expect(typeof ml.config.getAll).toBe('function');
    expect(typeof ml.config.onDidChange).toBe('function');
    expect(await ml.config.get('url')).toBe('http://d');
  });

  it('returns no-op stubs when config service is absent', async () => {
    const ml = createMongolens({
      pluginId: 'acme.p',
      registries: createRegistrySet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: {} as any,
      logger: silentLogger(),
      manifest: { id: 'acme.p', name: 'P', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'm.js' },
    });
    expect(await ml.config.get('anything')).toBeUndefined();
    expect(await ml.config.getAll()).toEqual({});
    await expect(ml.config.set('k', 'v')).rejects.toThrow(/no contributes\.configuration/i);
    const d = ml.config.onDidChange(() => {});
    expect(typeof d.dispose).toBe('function');
  });
});
