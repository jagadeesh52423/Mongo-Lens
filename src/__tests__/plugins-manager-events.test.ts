import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() { return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }; }

const MANIFEST = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  activationEvents: ['onCommand:foo.run', 'onStartup'],
  contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
};
const ENTRY = `export function activate(ctx){
  const d = mongolens.commands.register('foo.run', () => 'ran');
  ctx.subscriptions.push(d);
}`;

describe('activation events', () => {
  it('activateForEvent(onCommand:foo.run) activates only matching plugins', async () => {
    const registries = createRegistrySet();
    const mgr = new PluginManager({
      registries, broker: new PermissionBroker(), hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    expect(mgr.get('acme.foo')?.state).toBe('discovered');
    await mgr.activateForEvent('onCommand:foo.run');
    expect(mgr.get('acme.foo')?.state).toBe('active');
  });

  it('activateStartup activates plugins with onStartup', async () => {
    const registries = createRegistrySet();
    const mgr = new PluginManager({
      registries, broker: new PermissionBroker(), hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activateStartup();
    expect(mgr.get('acme.foo')?.state).toBe('active');
  });

  it('idempotent: re-activating an active plugin is a no-op', async () => {
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activateForEvent('onCommand:foo.run');
    await mgr.activateForEvent('onCommand:foo.run'); // should not double-register
    expect(mgr.get('acme.foo')?.state).toBe('active');
  });
});
