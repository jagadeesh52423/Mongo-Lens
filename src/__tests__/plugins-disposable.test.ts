import { toDisposable, DisposableStore } from '../plugins/api/disposable';

describe('Disposable', () => {
  it('toDisposable wraps a function and invokes it once on dispose', () => {
    const fn = vi.fn();
    const d = toDisposable(fn);
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('DisposableStore disposes all children in LIFO order', async () => {
    const order: number[] = [];
    const store = new DisposableStore();
    store.add(toDisposable(() => order.push(1)));
    store.add(toDisposable(() => order.push(2)));
    await store.dispose();
    expect(order).toEqual([2, 1]);
  });

  it('DisposableStore.add after dispose throws', () => {
    const store = new DisposableStore();
    store.dispose();
    expect(() => store.add(toDisposable(() => {}))).toThrow(/disposed/);
  });
});
