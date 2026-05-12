import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { parseScope } from '../plugins/permissions';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const MANIFEST = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  permissions: ['database:read'],
  activationEvents: ['onCommand:foo.run'],
  contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
};

const ENTRY = `
export function activate(ctx) {
  const d = mongolens.commands.register('foo.run', () => 'ran-foo');
  ctx.subscriptions.push(d);
}
`;

describe('PluginManager activation', () => {
  it('activate() imports entry, runs activate(), registers commands', async () => {
    const registries = createRegistrySet();
    const broker = new PermissionBroker();
    broker.setGrants('acme.foo', [parseScope('database:read')]);
    const mgr = new PluginManager({
      registries, broker, hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activate('acme.foo');
    expect(mgr.get('acme.foo')?.state).toBe('active');
    expect(registries.commands.get('foo.run')?.handler()).toBe('ran-foo');
  });

  it('deactivate() disposes all subscriptions and clears registry entries', async () => {
    const registries = createRegistrySet();
    const broker = new PermissionBroker();
    broker.setGrants('acme.foo', []);
    const mgr = new PluginManager({
      registries, broker, hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activate('acme.foo');
    expect(registries.commands.get('foo.run')).toBeDefined();
    await mgr.deactivate('acme.foo');
    expect(mgr.get('acme.foo')?.state).toBe('disabled');
    expect(registries.commands.get('foo.run')).toBeUndefined();
  });

  it('marks plugin as failed when activate() throws, never crashes host', async () => {
    const failing = `export function activate(){ throw new Error('nope'); }`;
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => failing,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activate('acme.foo');           // must not throw
    expect(mgr.get('acme.foo')?.state).toBe('failed');
  });
});
