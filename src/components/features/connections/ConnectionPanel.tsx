import { useEffect, useState } from 'react';
import { listConnections, onSshSessionLost } from '../../../ipc';
import { useConnectionsStore } from '../../../store/connections';
import { useConnectionsV2 } from './useConnectionsV2';
import { useEditorStore } from '../../../store/editor';
import { ConnectionDialogV2 } from './dialog-v2/ConnectionDialogV2';
import { ConnectionTree } from './ConnectionTree';
import { prefsGet } from '../../../connection/ipc';
import { DEFAULT_GLOBAL_PREFS, type GlobalPrefs } from '../../../connection/overrides';
import { ContextMenu } from '../../ui/ContextMenu';
import { PassphraseDialog } from './PassphraseDialog';
import { HostKeyDialog } from './HostKeyDialog';
import { ConnectionErrorDialog } from './ConnectionErrorDialog';
import { useConnectionActions } from './useConnectionActions';
import { IconButton, Panel } from '../../ui';
import type { Connection } from '../../../types';
import styles from './ConnectionPanel.module.css';

export { nextDuplicateName } from './nameUtils';

export function ConnectionPanel() {
  const { connections, connectedIds, setConnections, markDisconnected } = useConnectionsStore();
  const v2Connections = useConnectionsV2((s) => s.connections);
  const refreshV2 = useConnectionsV2((s) => s.refresh);
  const saveV2Store = useConnectionsV2((s) => s.save);
  const actions = useConnectionActions();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; connection: Connection } | null>(null);
  const [globals, setGlobals] = useState<GlobalPrefs>(DEFAULT_GLOBAL_PREFS);
  const openTab = useEditorStore((s) => s.openTab);

  function openCollectionScriptTab(db: string, col: string, cId: string) {
    openTab({
      id: `script:${cId}:${db}:${col}:${Date.now()}`,
      title: col,
      content: `db.getCollection("${col}").find({})`,
      isDirty: false,
      type: 'script',
      connectionId: cId,
      database: db,
      collection: col,
    });
  }

  useEffect(() => {
    listConnections().then(setConnections).catch((e) => console.error(e));
    // Mirror-read from connections_v2 so the env-color stripe and the new
    // dialog have access to the v2 shape. Failures are non-fatal — the legacy
    // store still drives the rest of the UI.
    refreshV2().catch((e) => console.error('refreshV2 failed:', e));
    // Wrapped in Promise.resolve so an undefined IPC response (test mocks
    // that don't enumerate every call) doesn't throw on `.then`.
    Promise.resolve(prefsGet())
      .then((p) => p && setGlobals(p))
      .catch((e) => console.error('prefsGet failed:', e));
  }, [setConnections, refreshV2]);

  // Listen for SSH session-loss events from the Rust backend and flip the
  // connection state to disconnected so the UI reflects the drop immediately.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSshSessionLost(({ connectionId }) => {
      markDisconnected(connectionId);
      actions.setExpanded(new Set([...actions.expandedConns].filter((x) => x !== connectionId)));
    })
      .then((fn) => { unlisten = fn; })
      .catch((e) => console.error('ssh_session_lost listener error:', e));
    return () => { unlisten?.(); };
    // actions.expandedConns intentionally omitted — the listener body reads
    // the latest value via closure capture, but recreating the listener on
    // every expansion change would thrash the IPC subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markDisconnected]);

  return (
    <Panel>
      <Panel.Header
        title="Connections"
        right={
          <IconButton
            aria-label="Add connection"
            tooltip="Add connection"
            size="sm"
            icon="+"
            onClick={() => setCreating(true)}
          />
        }
      />
      <Panel.Body>
        <ul className={styles.list}>
          {connections.map((c) => {
            const connected = connectedIds.has(c.id);
            const envColor = v2Connections.find((v) => v.id === c.id)?.color;
            return (
              <li
                key={c.id}
                className={styles.item}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, connection: c });
                }}
              >
                <div
                  className={styles.row}
                  data-testid={`conn-row-${c.id}`}
                  style={envColor ? { borderLeftColor: envColor } : undefined}
                >
                  <span className={connected ? styles.statusDotConnected : styles.statusDot}>●</span>
                  <span
                    onClick={() => connected && actions.toggleExpanded(c.id)}
                    className={`${styles.name} ${connected ? styles.nameClickable : ''}`}
                  >
                    {c.name}
                  </span>
                  {connected ? (
                    <button onClick={() => actions.disconnect(c)}>Disconnect</button>
                  ) : (
                    <button onClick={() => actions.connect(c)}>Connect</button>
                  )}
                </div>
                {connected && actions.expandedConns.has(c.id) && (
                  <ConnectionTree
                    connectionId={c.id}
                    onOpenCollection={(db, col) => openCollectionScriptTab(db, col, c.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Panel.Body>
      {(creating || editing) && (
        <ConnectionDialogV2
          initial={
            editing
              ? (v2Connections.find((v) => v.id === editing.id) ?? null)
              : null
          }
          globals={globals}
          onSave={async (input) => {
            const saved = await saveV2Store(input);
            setEditing(null);
            setCreating(false);
            return saved;
          }}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { label: 'Edit', action: () => setEditing(contextMenu.connection) },
            { label: 'Duplicate', action: () => actions.duplicate(contextMenu.connection) },
            { label: 'Delete', action: () => actions.remove(contextMenu.connection) },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {actions.passphraseFor && (
        <PassphraseDialog
          connectionName={actions.passphraseFor.name}
          onConfirm={actions.submitPassphrase}
          onCancel={() => actions.setPassphraseFor(null)}
        />
      )}
      {actions.connectError && (
        <ConnectionErrorDialog
          message={actions.connectError}
          onClose={actions.clearConnectError}
        />
      )}
      {actions.pendingHostKey && (
        <HostKeyDialog
          host={actions.pendingHostKey.host}
          port={actions.pendingHostKey.port}
          algorithm={actions.pendingHostKey.algorithm}
          fingerprint={actions.pendingHostKey.fingerprint}
          onAccept={actions.acceptHostKey}
          onReject={() => actions.setPendingHostKey(null)}
        />
      )}
    </Panel>
  );
}
