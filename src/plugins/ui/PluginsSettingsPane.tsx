import { ReactElement, useEffect, useState } from 'react';
import type { PluginRecord } from '../PluginManager';
import type { PluginFs } from '../io';
import { PluginList } from './PluginList';
import { PluginDetailPane } from './PluginDetailPane';

interface Props {
  records: PluginRecord[];
  fs: PluginFs;
  onInstall:   () => void;
  onEnable:    (id: string) => void;
  onDisable:   (id: string) => void;
  onUninstall: (id: string) => void;
}

export function PluginsSettingsPane(p: Props): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId === null && p.records.length > 0) {
      setSelectedId(p.records[0].id);
      return;
    }
    if (selectedId !== null && !p.records.some(r => r.id === selectedId)) {
      setSelectedId(p.records[0]?.id ?? null);
    }
  }, [p.records, selectedId]);

  const selected = p.records.find(r => r.id === selectedId) ?? null;

  return (
    <section aria-label="Plugins" className="plugins-settings">
      <header>
        <h2>Plugins</h2>
        <button onClick={p.onInstall}>Install from folder…</button>
      </header>
      {p.records.length === 0 ? (
        <p className="empty-state">No plugins installed.</p>
      ) : (
        <div className="plugins-master-detail" style={{ display: 'flex' }}>
          <PluginList
            records={p.records}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <PluginDetailPane
            record={selected}
            fs={p.fs}
            onEnable={p.onEnable}
            onDisable={p.onDisable}
            onUninstall={p.onUninstall}
          />
        </div>
      )}
    </section>
  );
}
