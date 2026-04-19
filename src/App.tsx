import { useState, useEffect } from 'react';
import { IconRail, type PanelKey } from './components/layout/IconRail';
import { SidePanel } from './components/layout/SidePanel';
import { StatusBar } from './components/layout/StatusBar';
import { ConnectionPanel } from './components/connections/ConnectionPanel';
import { EditorArea } from './components/editor/EditorArea';
import { SavedScriptsPanel } from './components/saved-scripts/SavedScriptsPanel';
import { SettingsView } from './settings/SettingsView';
import { useConnectionsStore } from './store/connections';
import { useScriptEvents } from './hooks/useScriptEvents';
import { checkNodeRunner, installNodeRunner } from './ipc';
import { keyboardService } from './services/KeyboardService';

export default function App() {
  useScriptEvents();

  useEffect(() => {
    // Prevent WKWebView from forwarding Escape to the native macOS responder
    // chain, which exits fullscreen. Capture phase fires before any element
    // handler (including Monaco), so this covers all focus positions.
    function suppressEscDefault(e: KeyboardEvent) {
      if (e.key === 'Escape') e.preventDefault();
    }
    window.addEventListener('keydown', suppressEscDefault, true);
    return () => window.removeEventListener('keydown', suppressEscDefault, true);
  }, []);

  useEffect(() => {
    checkNodeRunner().then((status) => {
      console.log('[runner] check:', status);
      if (!status.ready) {
        console.log('[runner] not ready, installing...');
        installNodeRunner()
          .then(() => console.log('[runner] install complete'))
          .catch((e) => console.error('[runner] install failed:', e));
      }
    }).catch((e) => console.error('[runner] check failed:', e));
  }, []);
  const [panel, setPanel] = useState<PanelKey>('connections');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { connections, activeConnectionId, activeDatabase } = useConnectionsStore();
  const active = connections.find((c) => c.id === activeConnectionId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyboardService.dispatch(e);
    window.addEventListener('keydown', handler, false);
    return () => window.removeEventListener('keydown', handler, false);
  }, []);

  useEffect(() => {
    return keyboardService.register({
      id: 'open-settings',
      keys: { cmd: true, key: ',' },
      label: 'Open Settings',
      action: () => setSettingsOpen((s) => !s),
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <IconRail
          active={panel}
          onChange={setPanel}
          onSettingsOpen={() => setSettingsOpen((s) => !s)}
          settingsOpen={settingsOpen}
        />
        {settingsOpen ? (
          <SettingsView onClose={() => setSettingsOpen(false)} />
        ) : (
          <>
            <SidePanel active={panel}>
              {panel === 'connections' && <ConnectionPanel />}
              {panel === 'saved' && <SavedScriptsPanel />}
              {panel === 'collections' && (
                <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Connect to a server to view collections.</div>
              )}
            </SidePanel>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <EditorArea />
            </div>
          </>
        )}
      </div>
      <StatusBar
        connectionName={active?.name}
        database={activeDatabase ?? undefined}
        nodeStatus="Node.js ready"
      />
    </div>
  );
}
