import { useEffect, useRef, useState } from 'react';
import { SaveScriptDialog } from '../saved-scripts/SaveScriptDialog';
import { useConnectionsStore } from '../../store/connections';
import { listDatabases } from '../../ipc';

interface Props {
  tabId: string;
  connectionId: string | undefined;
  database: string | undefined;
  onConnectionChange: (id: string) => void;
  onDatabaseChange: (db: string) => void;
  onRun: () => void;
  onSave: (name: string, tags: string) => Promise<void>;
  isRunning: boolean;
}

export function ContextBar({
  tabId,
  connectionId,
  database,
  onConnectionChange,
  onDatabaseChange,
  onRun,
  onSave,
  isRunning,
}: Props) {
  const connections = useConnectionsStore((s) => s.connections);
  const connectedIds = useConnectionsStore((s) => s.connectedIds);
  const connectedList = connections.filter((c) => connectedIds.has(c.id));
  const hasConnections = connectedList.length > 0;

  const [dbs, setDbs] = useState<string[]>([]);
  const [dbsLoading, setDbsLoading] = useState(false);
  const [dbsError, setDbsError] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, string[]>>({});

  useEffect(() => {
    if (!connectionId || !connectedIds.has(connectionId)) {
      setDbs([]);
      setDbsError(null);
      return;
    }
    const cached = cacheRef.current[connectionId];
    if (cached) {
      setDbs(cached);
      setDbsError(null);
      return;
    }
    let cancelled = false;
    setDbsLoading(true);
    setDbsError(null);
    listDatabases(connectionId)
      .then((list) => {
        if (cancelled) return;
        cacheRef.current[connectionId] = list;
        setDbs(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setDbsError((e as Error).message ?? String(e));
        setDbs([]);
      })
      .finally(() => {
        if (!cancelled) setDbsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, connectedIds]);

  const canRun = !!connectionId && !!database && !isRunning;
  const [saving, setSaving] = useState(false);

  return (
    <>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        minHeight: 36,
      }}
      data-tab-id={tabId}
    >
      {!hasConnections ? (
        <span style={{ color: 'var(--fg-dim)', fontStyle: 'italic' }}>
          No connections — connect in sidebar
        </span>
      ) : (
        <>
          <label style={{ color: 'var(--fg-dim)', fontSize: 12 }}>Connection</label>
          <select
            value={connectionId ?? ''}
            onChange={(e) => onConnectionChange(e.target.value)}
            style={{ minWidth: 160 }}
          >
            <option value="" disabled>
              Select connection…
            </option>
            {connectedList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label style={{ color: 'var(--fg-dim)', fontSize: 12, marginLeft: 4 }}>Database</label>
          <select
            value={database ?? ''}
            onChange={(e) => onDatabaseChange(e.target.value)}
            disabled={!connectionId || dbsLoading || !!dbsError}
            style={{ minWidth: 160 }}
          >
            <option value="" disabled>
              {!connectionId
                ? 'Pick a connection first'
                : dbsLoading
                ? 'Loading…'
                : dbsError
                ? 'Failed to load'
                : 'Pick a database…'}
            </option>
            {dbs.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {dbsError && (
            <span style={{ color: 'var(--accent-red)', fontSize: 12 }} title={dbsError}>
              ⚠
            </span>
          )}
        </>
      )}
      <div style={{ flex: 1 }} />
      <button onClick={() => setSaving(true)}>+ Save</button>
      <button
        onClick={onRun}
        disabled={!canRun}
        style={{
          opacity: canRun ? 1 : 0.5,
          cursor: canRun ? 'pointer' : 'not-allowed',
        }}
      >
        ▶ Run
      </button>
    </div>
    {saving && (
      <SaveScriptDialog
        onSave={async (name, tags) => { await onSave(name, tags); setSaving(false); }}
        onCancel={() => setSaving(false)}
      />
    )}
  </>
  );
}
