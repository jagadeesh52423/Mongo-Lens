import { Disposable, toDisposable } from './api/disposable';

interface Entry<T> { item: T; owner: string; }

export class Registry<T extends { id: string }> {
  private entries = new Map<string, Entry<T>>();
  private listeners = new Set<() => void>();

  constructor(public readonly name: string) {}

  register(item: T, ownerPluginId: string): Disposable {
    if (this.entries.has(item.id)) {
      throw new Error(
        `Registry[${this.name}]: id "${item.id}" already registered (owner=${this.entries.get(item.id)!.owner})`,
      );
    }
    this.entries.set(item.id, { item, owner: ownerPluginId });
    this.fire();
    return toDisposable(() => {
      if (this.entries.delete(item.id)) this.fire();
    });
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.item;
  }

  list(): readonly T[] {
    return Array.from(this.entries.values(), e => e.item);
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return toDisposable(() => { this.listeners.delete(listener); });
  }

  disposeForPlugin(pluginId: string): void {
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (entry.owner === pluginId) { this.entries.delete(id); changed = true; }
    }
    if (changed) this.fire();
  }

  private fire(): void {
    for (const l of this.listeners) { try { l(); } catch { /* listeners must not throw */ } }
  }
}
