import { useCallback, useEffect, useRef, useState } from 'react';
import { PluginHost } from './host';
import type { PluginRecord } from './PluginManager';
import { ConfigService } from './config/ConfigService';
import { ConfigStore } from './config/ConfigStore';

export function usePluginRecords(host: PluginHost): PluginRecord[] {
  const [records, setRecords] = useState(() => host.manager.list());
  useEffect(() => {
    const refresh = () => setRecords(host.manager.list());
    // Subscribe to every registry's onDidChange — change-driven UI refresh.
    const subs = Object.values(host.registries).map(r => r.onDidChange(refresh));
    // Also subscribe to manager-level changes (state, findings, activation).
    const managerSub = host.manager.onDidChange(refresh);
    return () => {
      subs.forEach(s => s.dispose());
      managerSub.dispose();
    };
  }, [host]);
  return records;
}

/** Returns a stable `getConfigService(pluginId)` that lazily constructs and caches ConfigService instances. */
export function useGetConfigService(host: PluginHost): (pluginId: string) => ConfigService | undefined {
  const cache = useRef<Map<string, ConfigService>>(new Map());

  return useCallback((pluginId: string): ConfigService | undefined => {
    const rec = host.manager.get(pluginId);
    const schema = rec?.manifest?.contributes?.configuration;
    if (!schema) return undefined;
    const existing = cache.current.get(pluginId);
    if (existing) return existing;
    const store = new ConfigStore(pluginId, schema, host.workspace, host.keychain);
    const svc = new ConfigService(pluginId, schema, store, host.broker, host.manager);
    cache.current.set(pluginId, svc);
    return svc;
  }, [host]);
}
