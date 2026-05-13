import { Disposable, toDisposable } from '../plugins/api/disposable';

export interface ActivityItem {
  id: string;
  title: string;
  icon: string;              // 1–4 char string (emoji or label)
  render(container: HTMLElement): { dispose(): void };
}

export interface ActivityRegistry {
  list(): ActivityItem[];
  onDidChange(cb: () => void): Disposable;
}

export class BuiltInActivityRegistry implements ActivityRegistry {
  private items: ActivityItem[] = [];
  private listeners = new Set<() => void>();

  add(item: ActivityItem): void {
    if (this.items.some(i => i.id === item.id)) {
      throw new Error(`ActivityRegistry: id "${item.id}" already registered`);
    }
    this.items.push(item);
    this.fire();
  }

  list(): ActivityItem[] {
    return [...this.items];
  }

  onDidChange(cb: () => void): Disposable {
    this.listeners.add(cb);
    return toDisposable(() => { this.listeners.delete(cb); });
  }

  private fire(): void {
    for (const l of this.listeners) { try { l(); } catch { /* never throw */ } }
  }
}
