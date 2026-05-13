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

interface ConfigServiceAPI {
  /** Lazily constructs and caches a ConfigService per plugin. */
  getConfigService: (pluginId: string) => ConfigService | undefined;
  /** Removes the cached ConfigService for a plugin. Call on uninstall to prevent leaks. */
  releaseConfigService: (pluginId: string) => void;
}

/** Returns a stable `getConfigService` and `releaseConfigService` pair backed by a ref-cached Map. */
export function useGetConfigService(host: PluginHost): ConfigServiceAPI {
  const cache = useRef<Map<string, ConfigService>>(new Map());

  const getConfigService = useCallback((pluginId: string): ConfigService | undefined => {
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

  const releaseConfigService = useCallback((pluginId: string): void => {
    cache.current.delete(pluginId);
  }, []);

  return { getConfigService, releaseConfigService };
}
