import { useEffect, useState } from 'react';
import { onSshSessionLost } from '../../../ipc';
import { useConnectionsV2 } from './useConnectionsV2';
import { useEditorStore } from '../../../store/editor';
import { ConnectionDialogV2 } from './dialog-v2/ConnectionDialogV2';
import { ConnectionTree } from './ConnectionTree';
import { ConnectLauncher } from './ConnectLauncher';
import { prefsGet } from '../../../connection/ipc';
import { DEFAULT_GLOBAL_PREFS, type GlobalPrefs } from '../../../connection/overrides';
import { ContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { PassphraseDialog } from './PassphraseDialog';
import { HostKeyDialog } from './HostKeyDialog';
import { ConnectionErrorDialog } from './ConnectionErrorDialog';
import { useConnectionActions } from './useConnectionActions';
import { IconButton, Panel } from '../../ui';
import type { Connection } from '../../../connection/model';
import styles from './ConnectionPanel.module.css';

export { nextDuplicateName } from './nameUtils';

export function ConnectionPanel() {
  const connections = useConnectionsV2((s) => s.connections);
  const connectedIds = useConnectionsV2((s) => s.connectedIds);
  const markDisconnected = useConnectionsV2((s) => s.markDisconnected);
  const refreshV2 = useConnectionsV2((s) => s.refresh);
  const saveV2Store = useConnectionsV2((s) => s.save);
  const actions = useConnectionActions();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; connection: Connection } | null>(null);
  const [globals, setGlobals] = useState<GlobalPrefs>(DEFAULT_GLOBAL_PREFS);
  const openTab = useEditorStore((s) => s.openTab);

  // The launcher offers connections that aren't live; the body shows the live ones.
  const connected = connections.filter((c) => connectedIds.has(c.id));
  const available = connections.filter((c) => !connectedIds.has(c.id));

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
    // The v2 store is the sole source of truth for the connection list.
    refreshV2().catch((e) => console.error('refreshV2 failed:', e));
    Promise.resolve(prefsGet())
      .then((p) => p && setGlobals(p))
      .catch((e) => console.error('prefsGet failed:', e));
  }, [refreshV2]);

  // Reflect backend SSH session-loss by flipping the connection to disconnected.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSshSessionLost(({ connectionId }) => {
      markDisconnected(connectionId);
      actions.setExpanded(new Set([...actions.expandedConns].filter((x) => x !== connectionId)));
    })
      .then((fn) => { unlisten = fn; })
      .catch((e) => console.error('ssh_session_lost listener error:', e));
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markDisconnected]);

  // Context-menu items depend on whether the target is currently live.
  function menuItems(c: Connection): ContextMenuItem[] {
    const live = connectedIds.has(c.id);
    return [
      ...(live ? [{ label: 'Disconnect', action: () => actions.disconnect(c) }] : []),
      { label: 'Edit', action: () => setEditing(c) },
      { label: 'Duplicate', action: () => actions.duplicate(c) },
      { label: 'Delete', action: () => actions.remove(c) },
    ];
  }

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
      <Panel.Body className={styles.body}>
        <ConnectLauncher
          available={available}
          hasAnySaved={connections.length > 0}
          onConnect={actions.connect}
          onNewConnection={() => setCreating(true)}
          onItemContextMenu={(c, x, y) => setContextMenu({ x, y, connection: c })}
        />
        {connected.length > 0 && (
          <>
            <div className={styles.groupLabel}>Active</div>
            <ul className={styles.list}>
              {connected.map((c) => {
                const envColor = c.color;
                const isExpanded = actions.expandedConns.has(c.id);
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
                      onClick={() => actions.toggleExpanded(c.id)}
                    >
                      <span className={styles.caret} aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                      <span
                        className={styles.env}
                        data-testid={`conn-env-${c.id}`}
                        style={envColor ? { background: envColor } : undefined}
                        aria-hidden="true"
                      />
                      <span className={styles.name}>{c.name}</span>
                      <span className={styles.live} aria-label="Connected" />
                    </div>
                    {isExpanded && (
                      <ConnectionTree
                        connectionId={c.id}
                        onOpenCollection={(db, col) => openCollectionScriptTab(db, col, c.id)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel.Body>
      {(creating || editing) && (
        <ConnectionDialogV2
          initial={editing}
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
          items={menuItems(contextMenu.connection)}
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
