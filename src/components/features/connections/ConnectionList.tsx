import { useRef, useState } from 'react';
import type { Connection } from '../../../connection/model';
import { connectionSummary } from './connectionSummary';
import styles from './ConnectionList.module.css';

const PREFIX_RESET_MS = 600;

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
  highlighted,
  searching,
  rowRef,
  onRowClick,
  onContextMenu,
  renderTree,
}: {
  c: Connection;
  isConnected: boolean;
  isExpanded: boolean;
  highlighted: boolean;
  searching: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
  onRowClick: (c: Connection) => void;
  onContextMenu: (c: Connection, x: number, y: number) => void;
  renderTree?: (id: string) => React.ReactNode;
}) {
  const rowClass = [
    styles.row,
    isConnected ? styles.rowActive : '',
    highlighted ? styles.rowHighlighted : '',
  ].filter(Boolean).join(' ');

  return (
    <li
      className={styles.item}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(c, e.clientX, e.clientY);
      }}
    >
      <div
        ref={rowRef}
        className={rowClass}
        data-testid={`cl-row-${c.id}`}
        data-highlighted={highlighted || undefined}
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
  const [prefixHighlight, setPrefixHighlight] = useState<string | null>(null);

  const prefixBufRef = useRef('');
  const prefixTimerRef = useRef<number | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  function handleWrapperKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (document.activeElement === searchInputRef.current) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      setPrefixHighlight(null);
      prefixBufRef.current = '';
      return;
    }
    if (e.key.length !== 1 || !/^[A-Za-z0-9_.\-$ ]$/.test(e.key)) return;

    e.preventDefault();
    if (prefixTimerRef.current) window.clearTimeout(prefixTimerRef.current);
    prefixBufRef.current += e.key.toLowerCase();
    const prefix = prefixBufRef.current;
    const match = filtered.find((c) => c.name.toLowerCase().startsWith(prefix));
    if (match) {
      setPrefixHighlight(match.id);
      rowRefs.current.get(match.id)?.scrollIntoView?.({ block: 'nearest' });
      rowRefs.current.get(match.id)?.focus();
    }
    prefixTimerRef.current = window.setTimeout(() => {
      prefixBufRef.current = '';
    }, PREFIX_RESET_MS);
  }

  if (connections.length === 0) {
    return <div className={styles.empty}>No saved connections yet</div>;
  }

  function rowRefSetter(id: string) {
    return (el: HTMLDivElement | null) => { rowRefs.current.set(id, el); };
  }

  return (
    <div onKeyDown={handleWrapperKeyDown}>
      <div className={styles.searchWrap}>
        <input
          ref={searchInputRef}
          type="search"
          className={styles.search}
          placeholder="Filter connections…"
          aria-label="Filter connections"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPrefixHighlight(null); prefixBufRef.current = ''; }}
        />
      </div>
      {filtered.length === 0 && (
        <div className={styles.empty}>No connections match &ldquo;{query}&rdquo;</div>
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
                highlighted={prefixHighlight === c.id}
                searching={needle.length > 0}
                rowRef={rowRefSetter(c.id)}
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
                highlighted={prefixHighlight === c.id}
                searching={false}
                rowRef={rowRefSetter(c.id)}
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
