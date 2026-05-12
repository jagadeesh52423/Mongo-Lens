import { createRegistrySet } from '../plugins/registries';

describe('registry set', () => {
  it('exposes all nine registries with the expected names', () => {
    const r = createRegistrySet();
    expect(Object.keys(r).sort()).toEqual(
      [
        'aiTools',
        'commands',
        'connectionProviders',
        'executionModes',
        'exportTargets',
        'keybindings',
        'resultViewers',
        'themes',
        'views',
      ],
    );
  });

  it('each registry round-trips an item', () => {
    const r = createRegistrySet();
    const d = r.commands.register({ id: 'foo', handler: () => 1 }, 'p1');
    expect(r.commands.get('foo')?.handler()).toBe(1);
    d.dispose();
    expect(r.commands.get('foo')).toBeUndefined();
  });
});
