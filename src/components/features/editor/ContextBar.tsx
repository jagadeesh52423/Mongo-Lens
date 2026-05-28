import { useEffect, useRef, useState } from 'react';
import { Toolbar } from '../../ui';
import { SaveScriptDialog } from '../saved-scripts/SaveScriptDialog';
import { useConnectionsV2 } from '../connections/useConnectionsV2';
import { listDatabases } from '../../../ipc';
import type { ExecutionMode } from '../../../execution-modes';
import styles from './ContextBar.module.css';

interface Props {
  tabId: string;
  connectionId: string | undefined;
  database: string | undefined;
  onConnectionChange: (id: string) => void;
  onDatabaseChange: (db: string) => void;
  modes: readonly ExecutionMode[];
  onExecute: (modeId: string) => void;
  onSave: () => Promise<void>;
  onSaveAs: (name: string, tags: string) => Promise<void>;
  hasSavedScript: boolean;
  isRunning: boolean;
}

function modeButtonClass(style: ExecutionMode['buttonStyle'], canRun: boolean): string {
  return [
    styles.modeBtn,
    style === 'filled' ? styles.modeBtnFilled : styles.modeBtnOutlined,
    !canRun && styles.modeBtnDisabled,
  ].filter(Boolean).join(' ');
}

export function ContextBar({
  tabId,
  connectionId,
  database,
  onConnectionChange,
  onDatabaseChange,
  modes,
  onExecute,
  onSave,
  onSaveAs,
  hasSavedScript,
  isRunning,
}: Props) {
  const connections = useConnectionsV2((s) => s.connections);
  const connectedIds = useConnectionsV2((s) => s.connectedIds);
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
      if (!database && cached.length === 1) onDatabaseChange(cached[0]);
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
        if (!database && list.length === 1) onDatabaseChange(list[0]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, connectedIds]);

  const canRun = !!connectionId && !!database && !isRunning;
  const [saving, setSaving] = useState(false);

  const left = !hasConnections ? (
    <span className={styles.empty}>No connections — connect in sidebar</span>
  ) : (
    <>
      <label className={styles.label}>Connection</label>
      <select
        value={connectionId ?? ''}
        onChange={(e) => onConnectionChange(e.target.value)}
        className={styles.picker}
      >
        <option value="" disabled>Select connection…</option>
        {connectedList.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <label className={`${styles.label} ${styles.labelOffset}`}>Database</label>
      <select
        value={database ?? ''}
        onChange={(e) => onDatabaseChange(e.target.value)}
        disabled={!connectionId || dbsLoading || !!dbsError}
        className={styles.picker}
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
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      {dbsError && (
        <span className={styles.errIcon} title={dbsError}>⚠</span>
      )}
    </>
  );

  const right = (
    <>
      {hasSavedScript && (
        <button onClick={async () => { await onSave(); }}>Save</button>
      )}
      <button onClick={() => setSaving(true)}>Save As</button>
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onExecute(mode.id)}
          disabled={!canRun}
          className={modeButtonClass(mode.buttonStyle, canRun)}
        >
          {mode.label}
        </button>
      ))}
    </>
  );

  return (
    <>
      <Toolbar data-tab-id={tabId} left={left} right={right} />
      {saving && (
        <SaveScriptDialog
          onSave={async (name, tags) => { await onSaveAs(name, tags); setSaving(false); }}
          onCancel={() => setSaving(false)}
        />
      )}
    </>
  );
}
