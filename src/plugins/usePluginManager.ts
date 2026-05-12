import { useEffect, useState } from 'react';
import { PluginHost } from './host';
import type { PluginRecord } from './PluginManager';

export function usePluginRecords(host: PluginHost): PluginRecord[] {
  const [records, setRecords] = useState(() => host.manager.list());
  useEffect(() => {
    // Subscribe to every registry's onDidChange — change-driven UI refresh.
    const subs = Object.values(host.registries).map(r => r.onDidChange(() => setRecords(host.manager.list())));
    return () => subs.forEach(s => s.dispose());
  }, [host]);
  return records;
}
