import { Registry } from '../plugins/Registry';

interface Foo { id: string; label: string; }

describe('Registry<T>', () => {
  it('register adds an item and returns a Disposable that removes it', () => {
    const r = new Registry<Foo>('foo');
    const d = r.register({ id: 'a', label: 'A' }, 'plugin-1');
    expect(r.get('a')).toEqual({ id: 'a', label: 'A' });
    d.dispose();
    expect(r.get('a')).toBeUndefined();
  });

  it('register rejects duplicate ids with a clear error', () => {
    const r = new Registry<Foo>('foo');
    r.register({ id: 'a', label: 'A' }, 'p1');
    expect(() => r.register({ id: 'a', label: 'A2' }, 'p2')).toThrow(/already registered/i);
  });

  it('list returns items in insertion order', () => {
    const r = new Registry<Foo>('foo');
    r.register({ id: 'a', label: 'A' }, 'p1');
    r.register({ id: 'b', label: 'B' }, 'p1');
    expect(r.list().map(i => i.id)).toEqual(['a', 'b']);
  });

  it('onDidChange fires on register and dispose', () => {
    const r = new Registry<Foo>('foo');
    const listener = vi.fn();
    r.onDidChange(listener);
    const d = r.register({ id: 'a', label: 'A' }, 'p1');
    d.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('disposeForPlugin removes everything owned by a plugin id', () => {
    const r = new Registry<Foo>('foo');
    r.register({ id: 'a', label: 'A' }, 'p1');
    r.register({ id: 'b', label: 'B' }, 'p2');
    r.disposeForPlugin('p1');
    expect(r.list().map(i => i.id)).toEqual(['b']);
  });
});
