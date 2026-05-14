import { useEffect, useState } from 'react';
import {
  listConnections,
  createConnection,
  updateConnection as ipcUpdate,
  deleteConnection as ipcDelete,
  connectConnection,
  disconnectConnection,
  onSshSessionLost,
} from '../../ipc';
import { useConnectionsStore } from '../../store/connections';
import { useEditorStore } from '../../store/editor';
import { ConnectionDialog } from './ConnectionDialog';
import { ConnectionTree } from './ConnectionTree';
import { ContextMenu } from '../ui/ContextMenu';
import { PassphraseDialog } from './PassphraseDialog';
import { HostKeyDialog } from './HostKeyDialog';
import type { Connection, ConnectionInput } from '../../types';

// Pending host-key confirmation state — stored while waiting for user input.
interface PendingHostKey {
  connectionId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  /** Passphrase already collected, if any, to re-supply on the retry call. */
  passphrase?: string;
}

export function ConnectionPanel() {
  const {
    connections,
    connectedIds,
    activeConnectionId,
    setConnections,
    addConnection,
    updateConnection,
    removeConnection,
    setActive,
    markConnected,
    markDisconnected,
  } = useConnectionsStore();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; connection: Connection } | null>(null);
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set());
  // SSH dialogs
  const [passphraseFor, setPassphraseFor] = useState<Connection | null>(null);
  const [pendingHostKey, setPendingHostKey] = useState<PendingHostKey | null>(null);
  const openTab = useEditorStore((s) => s.openTab);

  function toggleConnExpanded(id: string) {
    setExpandedConns((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

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
  }, [setConnections]);

  // Listen for SSH session-loss events from the Rust backend and flip the
  // connection state to disconnected so the UI reflects the drop immediately.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSshSessionLost(({ connectionId }) => {
      markDisconnected(connectionId);
      setExpandedConns((s) => {
        const n = new Set(s);
        n.delete(connectionId);
        return n;
      });
    })
      .then((fn) => { unlisten = fn; })
      .catch((e) => console.error('ssh_session_lost listener error:', e));
    return () => { unlisten?.(); };
  }, [markDisconnected]);

  async function handleSave(input: ConnectionInput) {
    if (editing) {
      const updated = await ipcUpdate(editing.id, input);
      updateConnection(updated);
    } else {
      const c = await createConnection(input);
      addConnection(c);
    }
    setEditing(null);
    setCreating(false);
  }

  async function handleDelete(c: Connection) {
    if (!confirm(`Delete connection "${c.name}"?`)) return;
    await ipcDelete(c.id);
    removeConnection(c.id);
  }

  /** Core connect logic, shared by first attempt, passphrase retry, and host-key retry. */
  async function doConnect(c: Connection, passphrase?: string, acceptHostKey?: boolean) {
    try {
      const result = await connectConnection(c.id, passphrase, acceptHostKey);
      if (result.type === 'connected') {
        markConnected(c.id);
        setExpandedConns((s) => new Set(s).add(c.id));
        setActive(c.id, null);
      } else if (result.type === 'passphraseRequired') {
        // Prompt for passphrase; on submit retry with it.
        setPassphraseFor(c);
      } else if (result.type === 'hostKeyUnknown') {
        // Prompt user to confirm fingerprint.
        setPendingHostKey({
          connectionId: result.connectionId,
          host: result.host,
          port: result.port,
          algorithm: result.algorithm,
          fingerprint: result.fingerprint,
          passphrase,
        });
      }
    } catch (e) {
      alert(`Connection error: ${(e as Error).message ?? String(e)}`);
    }
  }

  function handleConnect(c: Connection) {
    return doConnect(c);
  }

  function handlePassphraseConfirm(passphrase: string) {
    const c = passphraseFor;
    setPassphraseFor(null);
    if (c) doConnect(c, passphrase);
  }

  function handleHostKeyAccept() {
    const pending = pendingHostKey;
    setPendingHostKey(null);
    if (!pending) return;
    const c = connections.find((x) => x.id === pending.connectionId);
    if (c) doConnect(c, pending.passphrase, true);
  }

  async function handleDisconnect(c: Connection) {
    await disconnectConnection(c.id);
    markDisconnected(c.id);
    setExpandedConns((s) => {
      const n = new Set(s);
      n.delete(c.id);
      return n;
    });
    if (activeConnectionId === c.id) setActive(null, null);
  }

  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setCreating(true)}>+ Add</button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {connections.map((c) => {
          const connected = connectedIds.has(c.id);
          return (
            <li
              key={c.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, connection: c });
              }}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: connected ? 'var(--accent-green)' : 'var(--fg-dim)' }}>●</span>
                <span
                  onClick={() => connected && toggleConnExpanded(c.id)}
                  style={{ cursor: connected ? 'pointer' : 'default', flex: 1 }}
                >
                  {c.name}
                </span>
                {connected ? (
                  <button onClick={() => handleDisconnect(c)}>Disconnect</button>
                ) : (
                  <button onClick={() => handleConnect(c)}>Connect</button>
                )}
              </div>
              {connected && expandedConns.has(c.id) && (
                <ConnectionTree
                  connectionId={c.id}
                  onOpenCollection={(db, col) => openCollectionScriptTab(db, col, c.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {(creating || editing) && (
        <ConnectionDialog
          initial={editing ?? undefined}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { label: 'Edit', action: () => setEditing(contextMenu.connection) },
            { label: 'Delete', action: () => handleDelete(contextMenu.connection) },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {passphraseFor && (
        <PassphraseDialog
          connectionName={passphraseFor.name}
          onConfirm={handlePassphraseConfirm}
          onCancel={() => setPassphraseFor(null)}
        />
      )}
      {pendingHostKey && (
        <HostKeyDialog
          host={pendingHostKey.host}
          port={pendingHostKey.port}
          algorithm={pendingHostKey.algorithm}
          fingerprint={pendingHostKey.fingerprint}
          onAccept={handleHostKeyAccept}
          onReject={() => setPendingHostKey(null)}
        />
      )}
    </div>
  );
}
