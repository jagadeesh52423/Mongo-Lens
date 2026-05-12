import { createPluginHost } from '../plugins/host';

const MANIFEST = JSON.stringify({
  id: 'acme.smoke', name: 'Smoke', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  permissions: ['database:read'],
  activationEvents: ['onCommand:smoke.run'],
  contributes: { commands: [{ id: 'smoke.run', title: 'Run Smoke' }] },
});

const ENTRY = `
export function activate(ctx) {
  const d = mongolens.commands.register('smoke.run', () => 'smoked');
  ctx.subscriptions.push(d);
}
export function deactivate() {}
`;

describe('plugin host integration', () => {
  it('install → discover → activate by command event → execute → deactivate', async () => {
    const files = new Map<string, string>([
      ['/src/smoke/manifest.json', MANIFEST],
      ['/src/smoke/dist/main.js', ENTRY],
    ]);
    const dirs = new Set<string>();
    const fs = {
      pluginsRoot: '/installed',
      async listPluginDirs() { return Array.from(dirs); },
      async readManifest(dir: string) { return files.get(`${dir}/manifest.json`)!; },
      async readEntry(p: string) { return files.get(p) ?? ''; },
      pluginEntryPath: (d: string, m: string) => `${d}/${m}`,
      async copyDir(src: string, dest: string) {
        for (const [k, v] of files) if (k.startsWith(src + '/')) files.set(dest + k.slice(src.length), v);
        dirs.add(dest);
      },
      async removeDir(dir: string) {
        dirs.delete(dir);
        for (const k of Array.from(files.keys())) if (k.startsWith(dir + '/')) files.delete(k);
      },
    };
    const host = createPluginHost({
      hostApiVersion: '1.0.0',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      fs, pluginsRoot: fs.pluginsRoot,
    });

    await host.manager.install('/src/smoke');
    expect(host.manager.get('acme.smoke')?.state).toBe('discovered');

    await host.manager.activateForEvent('onCommand:smoke.run');
    expect(host.manager.get('acme.smoke')?.state).toBe('active');

    const cmd = host.registries.commands.get('smoke.run');
    expect(cmd).toBeDefined();
    expect(await cmd!.handler()).toBe('smoked');

    await host.manager.deactivate('acme.smoke');
    expect(host.registries.commands.get('smoke.run')).toBeUndefined();
  });
});
