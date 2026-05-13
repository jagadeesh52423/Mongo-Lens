import { describe, it, expect } from 'vitest';
import {
  BuiltInActivityRegistry,
  PluginActivityRegistry,
  CompositeActivityRegistry,
  resolveActiveId,
} from '../layout/activityBar';
import { Registry } from '../plugins/Registry';
import type { ViewProvider } from '../plugins/api/contracts';

function builtIn(id: string) {
  return { id, title: id, icon: id[0]!.toUpperCase(), render: () => ({ dispose() {} }) };
}
function vp(id: string): ViewProvider {
  return { id, title: id, location: 'sidebar', render: () => ({ dispose() {} }) };
}

describe('App activity-bar integration', () => {
  it('persisted id resolves through composite registry', () => {
    const built = new BuiltInActivityRegistry();
    built.add(builtIn('connections'));
    built.add(builtIn('saved'));
    const views = new Registry<ViewProvider>('views');
    views.register(vp('p.x'), 'p');
    const comp = new CompositeActivityRegistry([built, new PluginActivityRegistry(views)]);
    expect(resolveActiveId(comp.list(), 'p.x')).toBe('p.x');
  });

  it('plugin uninstall mid-session: active id falls back to first item', () => {
    const built = new BuiltInActivityRegistry();
    built.add(builtIn('connections'));
    const views = new Registry<ViewProvider>('views');
    views.register(vp('p.x'), 'p');
    const par = new PluginActivityRegistry(views);
    const comp = new CompositeActivityRegistry([built, par]);
    expect(resolveActiveId(comp.list(), 'p.x')).toBe('p.x');
    views.disposeForPlugin('p');
    expect(resolveActiveId(comp.list(), 'p.x')).toBe('connections');
  });

  it('plugin activates after boot: icon appears, active stays', () => {
    const built = new BuiltInActivityRegistry();
    built.add(builtIn('connections'));
    const views = new Registry<ViewProvider>('views');
    const par = new PluginActivityRegistry(views);
    const comp = new CompositeActivityRegistry([built, par]);
    expect(resolveActiveId(comp.list(), null)).toBe('connections');
    views.register(vp('p.x'), 'p');
    expect(comp.list().map(i => i.id)).toEqual(['connections', 'p.x']);
    expect(resolveActiveId(comp.list(), null)).toBe('connections'); // does not auto-switch
  });
});
