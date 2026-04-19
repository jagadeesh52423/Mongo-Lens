import { useEffect, useState } from 'react';
import {
  listConnections,
  createConnection,
  updateConnection as ipcUpdate,
  deleteConnection as ipcDelete,
  connectConnection,
  disconnectConnection,
} from '../../ipc';
import { useConnectionsStore } from '../../store/connections';
import { useEditorStore } from '../../store/editor';
import { ConnectionDialog } from './ConnectionDialog';
import { ConnectionTree } from './ConnectionTree';
import { ContextMenu } from '../ui/ContextMenu';
import type { Connection, ConnectionInput } from '../../types';

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

  async function handleConnect(c: Connection) {
    try {
      await connectConnection(c.id);
      markConnected(c.id);
      setExpandedConns((s) => new Set(s).add(c.id));
      setActive(c.id, null);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    }
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
    </div>
  );
}
