import { describe, it, expect } from 'vitest';
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('PluginManager view icon fallback', () => {
  it('uses manifest icon when register() omits it', async () => {
    const manifest = {
      id: 'acme.views', name: 'Views', version: '1.0.0',
      engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
      activationEvents: ['onStartup'],
      contributes: {
        views: [{ id: 'v', title: 'X', icon: '🚀', location: 'sidebar' }],
      },
    };

    // Plugin entry registers the view WITHOUT an icon
    const entry = `
export function activate(ctx) {
  const d = mongolens.views.register({
    id: 'v',
    title: 'X',
    location: 'sidebar',
    render: () => ({ dispose() {} }),
  });
  ctx.subscriptions.push(d);
}
`;

    const registries = createRegistrySet();
    const mgr = new PluginManager({
      registries,
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.views'],
        readManifest: async () => JSON.stringify(manifest),
        readEntry: async () => entry,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });

    await mgr.discover();
    await mgr.activate('acme.views');

    // The views registry should have the manifest icon filled in
    expect(registries.views.get('v')?.icon).toBe('🚀');
  });
});
