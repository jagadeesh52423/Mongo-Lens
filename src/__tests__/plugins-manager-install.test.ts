import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() { return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }; }

class FakeFs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  pluginsRoot = '/installed';
  async listPluginDirs() { return Array.from(this.dirs); }
  async readManifest(dir: string) { return this.files.get(`${dir}/manifest.json`)!; }
  async readEntry(p: string) { return this.files.get(p) ?? ''; }
  pluginEntryPath(d: string, m: string) { return `${d}/${m}`; }
  async copyDir(src: string, dest: string) {
    for (const [path, content] of this.files) {
      if (path.startsWith(src + '/')) {
        const rel = path.slice(src.length);
        this.files.set(dest + rel, content);
      }
    }
    this.dirs.add(dest);
  }
  async removeDir(dir: string) {
    this.dirs.delete(dir);
    for (const k of Array.from(this.files.keys())) if (k.startsWith(dir + '/')) this.files.delete(k);
  }
}

const MANIFEST = JSON.stringify({
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
});

describe('PluginManager install/uninstall', () => {
  it('install copies a source folder into pluginsRoot and discovers the plugin', async () => {
    const fs = new FakeFs();
    fs.files.set('/src/foo/manifest.json', MANIFEST);
    fs.files.set('/src/foo/dist/main.js', 'export function activate(){}');
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs, pluginsRoot: fs.pluginsRoot,
    });
    await mgr.install('/src/foo');
    expect(fs.dirs.has('/installed/acme.foo')).toBe(true);
    expect(mgr.get('acme.foo')?.state).toBe('discovered');
  });

  it('uninstall removes the folder and drops the record', async () => {
    const fs = new FakeFs();
    fs.files.set('/src/foo/manifest.json', MANIFEST);
    fs.files.set('/src/foo/dist/main.js', 'export function activate(){}');
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs, pluginsRoot: fs.pluginsRoot,
    });
    await mgr.install('/src/foo');
    await mgr.uninstall('acme.foo');
    expect(fs.dirs.has('/installed/acme.foo')).toBe(false);
    expect(mgr.get('acme.foo')).toBeUndefined();
  });

  it('install rejects a folder with an invalid manifest', async () => {
    const fs = new FakeFs();
    fs.files.set('/src/bad/manifest.json', '{ "id": "no-dot" }');
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs, pluginsRoot: fs.pluginsRoot,
    });
    await expect(mgr.install('/src/bad')).rejects.toThrow(/invalid manifest/i);
  });
});
