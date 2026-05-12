import { createMongolens } from '../plugins/api/createMongolens';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

describe('mongolens facade', () => {
  it('exposes commands.register and routes ownership to the pluginId', () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1',
      registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    const d = api.commands.register('foo', () => 'bar');
    expect(set.commands.get('foo')?.handler()).toBe('bar');
    d.dispose();
    expect(set.commands.get('foo')).toBeUndefined();
  });

  it('commands.execute looks up and invokes the registered command', async () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    api.commands.register('add', (a: number, b: number) => a + b);
    await expect(api.commands.execute('add', 2, 3)).resolves.toBe(5);
  });

  it('throws when executing an unknown command', async () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    await expect(api.commands.execute('missing')).rejects.toThrow(/unknown command/i);
  });

  it('db.find routes to host services', async () => {
    const find = vi.fn().mockResolvedValue([1]);
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find }, net: { fetch: vi.fn() } },
    });
    await expect(api.db.find('coll', {})).resolves.toEqual([1]);
  });

  // Ensure unused param does not fail strict TS — broker present in real wiring
  it('does not leak broker into the api surface', () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    expect((api as Record<string, unknown>).broker).toBeUndefined();
    new PermissionBroker(); // touch import so strict TS doesn't complain
  });
});
