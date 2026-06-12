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

export function ConnectionList({
  connections,
  connectedIds,
  expandedConns,
  onConnect,
  onToggleExpanded,
  onItemContextMenu,
  renderTree,
}: Props) {
  if (connections.length === 0) {
    return <div className={styles.empty}>No saved connections yet</div>;
  }

  function handleRowClick(c: Connection) {
    if (connectedIds.has(c.id)) {
      onToggleExpanded(c.id);
    } else {
      onConnect(c);
    }
  }

  return (
    <ul className={styles.list} role="list">
      {connections.map((c) => {
        const isConnected = connectedIds.has(c.id);
        const isExpanded = expandedConns.has(c.id);
        return (
          <li
            key={c.id}
            className={styles.item}
            onContextMenu={(e) => {
              e.preventDefault();
              onItemContextMenu(c, e.clientX, e.clientY);
            }}
          >
            <div
              className={`${styles.row}${isConnected ? ` ${styles.rowActive}` : ''}`}
              data-testid={`cl-row-${c.id}`}
              onClick={() => handleRowClick(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRowClick(c); }}
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
            {isConnected && isExpanded && renderTree?.(c.id)}
          </li>
        );
      })}
    </ul>
  );
}
