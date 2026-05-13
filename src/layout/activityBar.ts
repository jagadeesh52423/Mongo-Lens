import { Disposable, toDisposable } from '../plugins/api/disposable';
import { Registry } from '../plugins/Registry';
import type { ViewProvider } from '../plugins/api/contracts';

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

export class PluginActivityRegistry implements ActivityRegistry {
  constructor(private views: Registry<ViewProvider>) {}

  list(): ActivityItem[] {
    return this.views
      .list()
      .filter(v => v.location === 'sidebar')
      .map(v => this.toItem(v));
  }

  onDidChange(cb: () => void): Disposable {
    return this.views.onDidChange(cb);
  }

  private toItem(v: ViewProvider): ActivityItem {
    const icon = v.icon && v.icon.length > 0 ? v.icon : (v.title[0] ?? '?').toUpperCase();
    return {
      id: v.id,
      title: v.title,
      icon,
      render: (container: HTMLElement) => v.render(container, { container }),
    };
  }
}

export class CompositeActivityRegistry implements ActivityRegistry {
  constructor(private children: ActivityRegistry[]) {}

  list(): ActivityItem[] {
    return this.children.flatMap(c => c.list());
  }

  onDidChange(cb: () => void): Disposable {
    const subs = this.children.map(c => c.onDidChange(cb));
    return toDisposable(() => { for (const s of subs) s.dispose(); });
  }
}
