export interface Disposable {
  dispose(): void | Promise<void>;
}

export function toDisposable(fn: () => unknown): Disposable {
  let disposed = false;
  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      await fn();
    },
  };
}

export class DisposableStore implements Disposable {
  private items: Disposable[] = [];
  private disposed = false;

  add(d: Disposable): void {
    if (this.disposed) throw new Error('DisposableStore is already disposed');
    this.items.push(d);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.items.length - 1; i >= 0; i--) {
      try { await this.items[i].dispose(); } catch { /* swallow per-item; host logs upstream */ }
    }
    this.items = [];
  }
}
