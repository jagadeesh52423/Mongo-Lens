import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const MANIFEST = {
  id: 'test.onchange',
  name: 'On Change Test',
  version: '1.0.0',
  engines: { mongolens: '^1.0.0' },
  main: 'dist/main.js',
  activationEvents: [],
};

const ENTRY = `export function activate(ctx) {}`;

function makeManager() {
  return new PluginManager({
    registries: createRegistrySet(),
    broker: new PermissionBroker(),
    hostApiVersion: '1.0.0',
    logger: silentLogger(),
    fs: {
      listPluginDirs: async () => ['/plugins/test.onchange'],
      readManifest: async () => JSON.stringify(MANIFEST),
      readEntry: async () => ENTRY,
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
  });
}

describe('PluginManager.onDidChange', () => {
  it('fires when discover() loads a plugin', async () => {
    const mgr = makeManager();
    const spy = vi.fn();
    mgr.onDidChange(spy);
    await mgr.discover();
    expect(spy).toHaveBeenCalled();
  });

  it('fires when activate() transitions plugin to active', async () => {
    const mgr = makeManager();
    await mgr.discover();
    const spy = vi.fn();
    mgr.onDidChange(spy);
    await mgr.activate('test.onchange');
    expect(spy).toHaveBeenCalled();
  });

  it('fires when deactivate() transitions plugin to disabled', async () => {
    const mgr = makeManager();
    await mgr.discover();
    await mgr.activate('test.onchange');
    const spy = vi.fn();
    mgr.onDidChange(spy);
    await mgr.deactivate('test.onchange');
    expect(spy).toHaveBeenCalled();
  });

  it('fires when recheckEnforcement() updates findings', async () => {
    const mgr = makeManager();
    await mgr.discover();
    const spy = vi.fn();
    mgr.onDidChange(spy);
    await mgr.recheckEnforcement('test.onchange');
    expect(spy).toHaveBeenCalled();
  });

  it('dispose() stops listener from receiving further events', async () => {
    const mgr = makeManager();
    const spy = vi.fn();
    const sub = mgr.onDidChange(spy);
    sub.dispose();
    await mgr.discover();
    expect(spy).not.toHaveBeenCalled();
  });

  it('listener errors are swallowed — other listeners still fire', async () => {
    const mgr = makeManager();
    const throwing = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const safe = vi.fn();
    mgr.onDidChange(throwing);
    mgr.onDidChange(safe);
    await mgr.discover();
    expect(safe).toHaveBeenCalled();
  });
});
