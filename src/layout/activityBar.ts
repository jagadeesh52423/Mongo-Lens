import { Disposable, toDisposable } from '../plugins/api/disposable';
import { Registry } from '../plugins/Registry';
import type { ViewProvider } from '../plugins/api/contracts';

/**
 * A single entry in the activity bar (icon rail + side panel).
 *
 * **`render` cleanup contract:** `dispose()` MUST remove every DOM node and
 * tear down every observer the render created. The host no longer clears
 * `container.innerHTML` after calling `dispose()` — doing so would collide
 * with React root lifecycle tracking when the render used `createRoot`. If
 * your render creates a React root, call `root.unmount()` inside `dispose()`;
 * if it used plain DOM, remove those nodes explicitly.
 */
export interface ActivityItem {
  id: string;
  title: string;
  icon: string;              // 1–4 char string (emoji or label) — fallback when iconUrl is absent
  iconUrl?: string;          // optional asset URL for plugin-provided logo (rendered as <img>)
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

export interface IconLookup {
  /** Returns the asset URL for a plugin's icon if one is known, else undefined. */
  iconUrlFor(pluginId: string): string | undefined;
}

export class PluginActivityRegistry implements ActivityRegistry {
  constructor(
    private views: Registry<ViewProvider>,
    private iconLookup?: IconLookup,
  ) {}

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
    const ownerId = this.views.getOwner(v.id);
    const iconUrl = ownerId ? this.iconLookup?.iconUrlFor(ownerId) : undefined;
    return {
      id: v.id,
      title: v.title,
      icon,
      iconUrl,
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

export function resolveActiveId(items: ActivityItem[], persistedId: string | null): string | null {
  if (persistedId && items.some(i => i.id === persistedId)) return persistedId;
  return items[0]?.id ?? null;
}
