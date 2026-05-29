import styles from './StatusBar.module.css';

interface Props {
  connectionName?: string;
  database?: string;
  nodeStatus?: string;
}

export function StatusBar({ connectionName, database, nodeStatus }: Props) {
  return (
    <div className={styles.bar}>
      <span className={styles.connSegment}>
        <span
          className={connectionName ? styles.dotConnected : styles.dot}
          role="img"
          aria-label={connectionName ? 'Connected' : 'Disconnected'}
        />
        {connectionName ?? 'No connection'}
      </span>
      {database && <span className={styles.dbSegment}>{database}</span>}
      <span className={styles.spacer}>{nodeStatus ?? ''}</span>
    </div>
  );
}
