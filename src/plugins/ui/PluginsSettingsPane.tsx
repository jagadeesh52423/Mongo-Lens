import { CSSProperties, ReactElement, useEffect, useState } from 'react';
import type { PluginRecord } from '../PluginManager';
import type { PluginFs } from '../io';
import type { ConfigService } from '../config/ConfigService';
import { PluginList } from './PluginList';
import { PluginDetailPane } from './PluginDetailPane';
import { PluginConfigRoute } from './PluginConfigRoute';

interface Props {
  records: PluginRecord[];
  fs: PluginFs;
  onInstall:   () => void;
  onEnable:    (id: string) => void;
  onDisable:   (id: string) => void;
  onUninstall: (id: string) => void;
  getConfigService?: (pluginId: string) => ConfigService | undefined;
}

type ViewMode = 'detail' | 'config';

export function PluginsSettingsPane(p: Props): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('detail');

  useEffect(() => {
    if (selectedId === null && p.records.length > 0) {
      setSelectedId(p.records[0].id);
      return;
    }
    if (selectedId !== null && !p.records.some(r => r.id === selectedId)) {
      setSelectedId(p.records[0]?.id ?? null);
      setView('detail');
    }
  }, [p.records, selectedId]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const handleOpenConfig = (pluginId: string) => {
    setSelectedId(pluginId);
    setView('config');
  };

  const selected = p.records.find(r => r.id === selectedId) ?? null;
  const configService = selectedId ? p.getConfigService?.(selectedId) : undefined;

  return (
    <section aria-label="Plugins" className="plugins-settings" style={sectionStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>Plugins</h2>
        <button onClick={p.onInstall} style={installButtonStyle}>Install from folder…</button>
      </header>
      {p.records.length === 0 ? (
        <p className="empty-state" style={emptyStateStyle}>No plugins installed.</p>
      ) : (
        <div className="plugins-master-detail" style={masterDetailStyle}>
          <PluginList
            records={p.records}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
          {view === 'config' && selected ? (
            <PluginConfigRoute
              pluginName={selected.manifest?.name ?? selected.id}
              schema={selected.manifest?.contributes?.configuration ?? null}
              configService={configService}
              onBack={() => setView('detail')}
            />
          ) : (
            <PluginDetailPane
              record={selected}
              fs={p.fs}
              configService={configService}
              onEnable={p.onEnable}
              onDisable={p.onDisable}
              onUninstall={p.onUninstall}
              onOpenConfig={handleOpenConfig}
            />
          )}
        </div>
      )}
    </section>
  );
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 40,
  padding: '0 14px',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: 'var(--accent)',
  margin: 0,
  flex: 1,
};

const installButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--fg)',
  fontSize: 12,
  padding: '3px 10px',
  cursor: 'pointer',
};

const emptyStateStyle: CSSProperties = {
  padding: 20,
  color: 'var(--fg-dim)',
  fontSize: 13,
};

const masterDetailStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};
