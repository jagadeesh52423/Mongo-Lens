import { useState } from 'react';
import type { Connection } from '../../../connection/model';
import { connectionSummary } from './connectionSummary';
import styles from './ConnectionList.module.css';

interface Props {
  connections: Connection[];
  connectedIds: Set<string>;
  expandedConns: Set<string>;
  onConnect: (c: Connection) => void;
  onToggleExpanded: (id: string) => void;
  onItemContextMenu: (c: Connection, x: number, y: number) => void;
  renderTree?: (connectionId: string) => React.ReactNode;
}

function ConnectionRow({
  c,
  isConnected,
  isExpanded,
  searching,
  onRowClick,
  onContextMenu,
  renderTree,
}: {
  c: Connection;
  isConnected: boolean;
  isExpanded: boolean;
  searching: boolean;
  onRowClick: (c: Connection) => void;
  onContextMenu: (c: Connection, x: number, y: number) => void;
  renderTree?: (id: string) => React.ReactNode;
}) {
  return (
    <li
      className={styles.item}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(c, e.clientX, e.clientY);
      }}
    >
      <div
        className={`${styles.row}${isConnected ? ` ${styles.rowActive}` : ''}`}
        data-testid={`cl-row-${c.id}`}
        onClick={() => onRowClick(c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onRowClick(c); }}
      >
        {isConnected
          ? <span className={styles.caret} aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
          : <span className={styles.caretPlaceholder} aria-hidden="true" />}
        <span
          className={styles.env}
          data-testid={`cl-env-${c.id}`}
          style={c.color ? { background: c.color } : undefined}
          aria-hidden="true"
        />
        <span className={styles.meta}>
          <span className={styles.name}>{c.name}</span>
          <span className={styles.sub}>{connectionSummary(c.target)}</span>
        </span>
        {c.ssh && <span className={styles.ssh} aria-label="SSH tunnel">SSH</span>}
        {isConnected && <span className={styles.live} aria-label="Connected" />}
      </div>
      {isConnected && isExpanded && !searching && renderTree?.(c.id)}
    </li>
  );
}

export function ConnectionList({
  connections,
  connectedIds,
  expandedConns,
  onConnect,
  onToggleExpanded,
  onItemContextMenu,
  renderTree,
}: Props) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? connections.filter((c) => c.name.toLowerCase().includes(needle))
    : connections;

  const active = filtered.filter((c) => connectedIds.has(c.id));
  const available = filtered.filter((c) => !connectedIds.has(c.id));

  function handleRowClick(c: Connection) {
    if (connectedIds.has(c.id)) {
      onToggleExpanded(c.id);
    } else {
      onConnect(c);
    }
  }

  if (connections.length === 0) {
    return <div className={styles.empty}>No saved connections yet</div>;
  }

  return (
    <div>
      <div className={styles.searchWrap}>
        <input
          type="search"
          className={styles.search}
          placeholder="Filter connections…"
          aria-label="Filter connections"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filtered.length === 0 && (
        <div className={styles.empty}>No connections match "{query}"</div>
      )}
      {active.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Active</div>
          <ul className={styles.list} role="list">
            {active.map((c) => (
              <ConnectionRow
                key={c.id}
                c={c}
                isConnected
                isExpanded={expandedConns.has(c.id)}
                searching={needle.length > 0}
                onRowClick={handleRowClick}
                onContextMenu={onItemContextMenu}
                renderTree={renderTree}
              />
            ))}
          </ul>
        </>
      )}
      {available.length > 0 && (
        <>
          {active.length > 0 && <div className={styles.sectionLabel}>Available</div>}
          <ul className={styles.list} role="list">
            {available.map((c) => (
              <ConnectionRow
                key={c.id}
                c={c}
                isConnected={false}
                isExpanded={false}
                searching={false}
                onRowClick={handleRowClick}
                onContextMenu={onItemContextMenu}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
