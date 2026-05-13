import { describe, it, expect, vi } from 'vitest';
import { BuiltInActivityRegistry, type ActivityItem } from '../activityBar';

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
