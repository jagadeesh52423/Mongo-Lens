import { useState } from 'react';
import { IconRail, type PanelKey } from './components/layout/IconRail';
import { SidePanel } from './components/layout/SidePanel';
import { StatusBar } from './components/layout/StatusBar';
import { ConnectionPanel } from './components/connections/ConnectionPanel';
import { EditorArea } from './components/editor/EditorArea';
import { useConnectionsStore } from './store/connections';

export default function App() {
  const [panel, setPanel] = useState<PanelKey>('connections');
  const { connections, activeConnectionId, activeDatabase } = useConnectionsStore();
  const active = connections.find((c) => c.id === activeConnectionId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <IconRail active={panel} onChange={setPanel} />
        <SidePanel active={panel}>
          {panel === 'connections' && <ConnectionPanel />}
          {panel !== 'connections' && (
            <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Coming soon</div>
          )}
        </SidePanel>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <EditorArea />
        </div>
      </div>
      <StatusBar
        connectionName={active?.name}
        database={activeDatabase ?? undefined}
        nodeStatus="Node.js ready"
      />
    </div>
  );
}
