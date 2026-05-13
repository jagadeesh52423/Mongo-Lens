/**
 * Verifies that useGetConfigService clears the cache entry when
 * releaseConfigService(id) is called — preventing stale ConfigService
 * instances from surviving plugin uninstall.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGetConfigService } from '../plugins/usePluginManager';
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import type { PluginHost } from '../plugins/host';
import type { ConfigurationContribution } from '../plugins/manifest';
import type { WorkspaceLike } from '../plugins/config';

function silentLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

class FakeWorkspace implements WorkspaceLike {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'Test',
  properties: { url: { type: 'string', title: 'URL' } },
};

const MANIFEST = {
  id: 'test.cache',
  name: 'Cache Test',
  version: '1.0.0',
  engines: { mongolens: '^1.0.0' },
  main: 'dist/main.js',
  contributes: { configuration: schema },
};

function makeHost(): PluginHost {
  const registries = createRegistrySet();
  const broker = new PermissionBroker();
  const manager = new PluginManager({
    registries,
    broker,
    hostApiVersion: '1.0.0',
    logger: silentLogger(),
    fs: {
      listPluginDirs: async () => ['/plugins/test.cache'],
      readManifest: async () => JSON.stringify(MANIFEST),
      readEntry: async () => 'export function activate(ctx) {}',
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
  });
  const workspace = new FakeWorkspace();
  const keychain = new InMemoryKeychainBackend();
  return { manager, registries, broker, workspace, keychain, fs: {
    listPluginDirs: async () => [],
    readManifest: async () => '{}',
    readEntry: async () => '',
    pluginEntryPath: (d: string, m: string) => `${d}/${m}`,
  } } as unknown as PluginHost;
}

describe('useGetConfigService — cache invalidation', () => {
  it('returns the same instance on repeated calls (cache hit)', async () => {
    const host = makeHost();
    await host.manager.discover();
    const { result } = renderHook(() => useGetConfigService(host));
    const svc1 = result.current.getConfigService('test.cache');
    const svc2 = result.current.getConfigService('test.cache');
    expect(svc1).toBeDefined();
    expect(svc1).toBe(svc2);
  });

  it('returns a fresh instance after releaseConfigService — not the cached one', async () => {
    const host = makeHost();
    await host.manager.discover();
    const { result } = renderHook(() => useGetConfigService(host));

    const svcBefore = result.current.getConfigService('test.cache');
    expect(svcBefore).toBeDefined();

    // Release the cache entry (simulates uninstall cleanup)
    result.current.releaseConfigService('test.cache');

    // Next call should construct a fresh instance
    const svcAfter = result.current.getConfigService('test.cache');
    expect(svcAfter).toBeDefined();
    expect(svcAfter).not.toBe(svcBefore);
  });

  it('releaseConfigService on unknown id is a no-op (no throw)', () => {
    const host = makeHost();
    const { result } = renderHook(() => useGetConfigService(host));
    // Should not throw
    expect(() => result.current.releaseConfigService('no.such-plugin')).not.toThrow();
  });
});
