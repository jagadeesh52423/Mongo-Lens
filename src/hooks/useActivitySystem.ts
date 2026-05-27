import { useEffect, useState } from 'react';
import {
  CompositeActivityRegistry,
  PluginActivityRegistry,
  resolveActiveId,
  type ActivityItem,
} from '../layout/activityBar';
import type { Registry } from '../plugins/Registry';
import type { ViewProvider } from '../plugins/api/contracts';
import { useSettingsStore } from '../store/settings';
import { makeBuiltInRegistry } from '../components/features/layout/activityViewRegistry';

interface ActivitySystem {
  items: ActivityItem[];
  activeId: string | null;
  onChangeActive: (id: string) => void;
}

/**
 * Discover the activity-bar items: built-in views plus any plugin-contributed
 * views from `window.__pluginHost`. Polls for the plugin host to appear (it
 * is set asynchronously by `usePluginHostBootstrap`) and then subscribes to
 * registry changes so newly activated plugins appear without a reload.
 *
 * The active selection persists across sessions via `useSettingsStore`.
 */
export function useActivitySystem(): ActivitySystem {
  const persistedActiveId = useSettingsStore((s) => s.activeActivityItemId);
  const setPersistedActive = useSettingsStore((s) => s.setActiveActivityItemId);
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const builtIns = makeBuiltInRegistry();
    let composite: CompositeActivityRegistry = new CompositeActivityRegistry([builtIns]);
    setItems(composite.list());
    let topSub: { dispose(): void } | null = null;

    // Wait for the plugin host bootstrap to complete; it sets window.__pluginHost.
    const trySubscribe = () => {
      if (cancelled) return;
      const host = (window as unknown as {
        __pluginHost?: {
          registries: { views: Registry<ViewProvider> };
          manager?: { get(id: string): { iconUrl?: string } | undefined };
        };
      }).__pluginHost;
      if (!host) { pendingTimer = setTimeout(trySubscribe, 50); return; }
      const manager = host.manager;
      const iconLookup = manager
        ? { iconUrlFor: (pluginId: string) => manager.get(pluginId)?.iconUrl }
        : undefined;
      const pluginReg = new PluginActivityRegistry(host.registries.views, iconLookup);
      composite = new CompositeActivityRegistry([builtIns, pluginReg]);
      setItems(composite.list());
      // composite.onDidChange fans into every child (including pluginReg),
      // so a single subscription is sufficient — no need to also subscribe pluginReg.
      topSub = composite.onDidChange(() => { if (!cancelled) setItems(composite.list()); });
    };
    trySubscribe();

    return () => {
      cancelled = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      topSub?.dispose();
    };
  }, []);

  const activeId = resolveActiveId(items, persistedActiveId);
  return { items, activeId, onChangeActive: setPersistedActive };
}
