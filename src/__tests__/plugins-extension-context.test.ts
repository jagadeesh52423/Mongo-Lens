import { createExtensionContext } from '../plugins/ExtensionContext';
import { InMemorySecretStorage } from '../plugins/api/secretStorage';

describe('ExtensionContext', () => {
  it('builds a context tagged with pluginId and an empty subscriptions array', () => {
    const ctx = createExtensionContext({
      pluginId: 'acme.foo',
      storagePath: '/tmp/acme.foo',
      secrets: new InMemorySecretStorage(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(ctx.pluginId).toBe('acme.foo');
    expect(ctx.storagePath).toBe('/tmp/acme.foo');
    expect(ctx.subscriptions).toEqual([]);
  });
});
