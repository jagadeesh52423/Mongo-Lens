import { describe, it, expect, vi } from 'vitest';
import { BuiltInActivityRegistry, PluginActivityRegistry, CompositeActivityRegistry, type ActivityItem } from '../activityBar';
import { Registry } from '../../plugins/Registry';
import type { ViewProvider } from '../../plugins/api/contracts';

function vp(id: string, overrides: Partial<ViewProvider> = {}): ViewProvider {
  return {
    id,
    title: id,
    location: 'sidebar',
    render: () => ({ dispose() {} }),
    ...overrides,
  };
}

const itemA: ActivityItem = { id: 'a', title: 'A', icon: 'A', render: () => ({ dispose: () => {} }) };
const itemB: ActivityItem = { id: 'b', title: 'B', icon: 'B', render: () => ({ dispose: () => {} }) };

describe('BuiltInActivityRegistry', () => {
  it('starts empty', () => {
    expect(new BuiltInActivityRegistry().list()).toEqual([]);
  });

  it('add() appends in insertion order', () => {
    const r = new BuiltInActivityRegistry();
    r.add(itemA);
    r.add(itemB);
    expect(r.list().map(i => i.id)).toEqual(['a', 'b']);
  });

  it('add() of duplicate id throws', () => {
    const r = new BuiltInActivityRegistry();
    r.add(itemA);
    expect(() => r.add({ ...itemA, title: 'Other' })).toThrow(/already registered/i);
  });

  it('onDidChange fires on add', () => {
    const r = new BuiltInActivityRegistry();
    const cb = vi.fn();
    r.onDidChange(cb);
    r.add(itemA);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onDidChange unsubscribes on dispose', () => {
    const r = new BuiltInActivityRegistry();
    const cb = vi.fn();
    const d = r.onDidChange(cb);
    d.dispose();
    r.add(itemA);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('PluginActivityRegistry', () => {
  it('returns only sidebar-location items', () => {
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { location: 'sidebar' }), 'p1');
    reg.register(vp('y', { location: 'panel' }),   'p1');
    const par = new PluginActivityRegistry(reg);
    expect(par.list().map(i => i.id)).toEqual(['x']);
  });

  it('uses register icon when set', () => {
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { icon: '🚀' }), 'p1');
    const par = new PluginActivityRegistry(reg);
    expect(par.list()[0]!.icon).toBe('🚀');
  });

  it('falls back to first letter of title when icon missing', () => {
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { title: 'datafleet' }), 'p1');
    const par = new PluginActivityRegistry(reg);
    expect(par.list()[0]!.icon).toBe('D');
  });

  it('onDidChange proxies the underlying registry', () => {
    const reg = new Registry<ViewProvider>('views');
    const par = new PluginActivityRegistry(reg);
    const cb = vi.fn();
    par.onDidChange(cb);
    reg.register(vp('x'), 'p1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('render delegates to ViewProvider.render', () => {
    const inner = vi.fn(() => ({ dispose: vi.fn() }));
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { render: inner }), 'p1');
    const par = new PluginActivityRegistry(reg);
    const container = document.createElement('div');
    par.list()[0]!.render(container);
    expect(inner).toHaveBeenCalledWith(container, expect.objectContaining({ container }));
  });
});

describe('CompositeActivityRegistry', () => {
  it('concatenates children in given order', () => {
    const a = new BuiltInActivityRegistry();
    a.add(itemA);
    const b = new BuiltInActivityRegistry();
    b.add(itemB);
    const comp = new CompositeActivityRegistry([a, b]);
    expect(comp.list().map(i => i.id)).toEqual(['a', 'b']);
  });

  it('onDidChange fires when any child fires', () => {
    const a = new BuiltInActivityRegistry();
    const b = new BuiltInActivityRegistry();
    const comp = new CompositeActivityRegistry([a, b]);
    const cb = vi.fn();
    comp.onDidChange(cb);
    a.add(itemA);
    b.add(itemB);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('dispose unsubscribes from all children', () => {
    const a = new BuiltInActivityRegistry();
    const comp = new CompositeActivityRegistry([a]);
    const cb = vi.fn();
    const d = comp.onDidChange(cb);
    d.dispose();
    a.add(itemA);
    expect(cb).not.toHaveBeenCalled();
  });
});
