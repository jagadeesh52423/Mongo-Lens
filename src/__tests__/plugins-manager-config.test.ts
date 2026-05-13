import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { EnforcementRegistry } from '../plugins/enforcement/EnforcementRegistry';
import { requiredConfigRule } from '../plugins/enforcement/rules/requiredConfig';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string)        { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const PLUGIN_ID = 'acme.test';

const MANIFEST = {
  id: PLUGIN_ID, name: 'P', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'm.js',
  activation: { requireConfig: true },
  contributes: {
    configuration: {
      title: 'P',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
};

function makeMgr(workspace = new FakeWorkspace(), keychain = new InMemoryKeychainBackend()) {
  const enforcement = new EnforcementRegistry();
  enforcement.register(requiredConfigRule);
  return new PluginManager({
    registries: createRegistrySet(),
    broker: new PermissionBroker(),
    hostApiVersion: '1.0.0',
    logger: silentLogger(),
    fs: {
      listPluginDirs: async () => [`/plugins/${PLUGIN_ID}`],
      readManifest:    async () => JSON.stringify(MANIFEST),
      readEntry:       async () => 'export function activate(){}',
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
    enforcement,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workspace: workspace as any,
    keychain,
  });
}

describe('PluginManager config integration', () => {
  it('passes workspace + keychain into RuleContext (required-config gate fires)', async () => {
    const mgr = makeMgr();
    await mgr.discover();
    const rec = mgr.get(PLUGIN_ID)!;
    expect(rec.findings.some(f => f.ruleId === 'core.required-config' && f.severity === 'error')).toBe(true);
  });

  it('recheckEnforcement reruns rules and updates findings', async () => {
    const ws = new FakeWorkspace();
    const mgr = makeMgr(ws);
    await mgr.discover();
    expect(mgr.get(PLUGIN_ID)!.findings).toHaveLength(1);
    ws.store.set(`plugin.${PLUGIN_ID}.config.url`, 'http://x');
    await mgr.recheckEnforcement(PLUGIN_ID);
    expect(mgr.get(PLUGIN_ID)!.findings).toEqual([]);
  });

  it('recheckEnforcement is a no-op for unknown id', async () => {
    const mgr = makeMgr();
    await expect(mgr.recheckEnforcement('does-not-exist')).resolves.toBeUndefined();
  });
});
