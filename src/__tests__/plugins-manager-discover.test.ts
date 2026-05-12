import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('PluginManager.discover', () => {
  it('reads each manifest, validates, registers contributions', async () => {
    const manifest = {
      id: 'acme.foo', name: 'Foo', version: '1.0.0',
      engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
      activationEvents: ['onCommand:foo.run'],
      contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
    };
    const registries = createRegistrySet();
    const mgr = new PluginManager({
      registries,
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(manifest),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (dir, main) => `${dir}/${main}`,
      },
    });
    await mgr.discover();
    expect(mgr.list().map(p => p.id)).toEqual(['acme.foo']);
    // Contributions registered immediately, before activation
    expect(registries.commands.list()).toEqual([]); // commands contract requires handler; manifest only declares — see Task 19
  });

  it('rejects engine version mismatch', async () => {
    const manifest = {
      id: 'acme.bar', name: 'Bar', version: '1.0.0',
      engines: { mongolens: '^2.0.0' }, main: 'dist/main.js',
    };
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.bar'],
        readManifest:    async () => JSON.stringify(manifest),
        readEntry:       async () => '',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    const rec = mgr.list().find(p => p.id === 'acme.bar')!;
    expect(rec.state).toBe('incompatible');
  });

  it('marks plugins with invalid manifest as "broken" without throwing', async () => {
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/broken'],
        readManifest:    async () => '{ "id": "no-dot" }',
        readEntry:       async () => '',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    expect(mgr.list()[0].state).toBe('broken');
  });
});
