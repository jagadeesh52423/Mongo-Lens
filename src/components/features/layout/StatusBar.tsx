import styles from './StatusBar.module.css';

interface Props {
  connectionName?: string;
  database?: string;
  nodeStatus?: string;
}

export function StatusBar({ connectionName, database, nodeStatus }: Props) {
  return (
    <div className={styles.bar}>
      <span>
        <span className={connectionName ? styles.dotConnected : styles.dot}>●</span>{' '}
        {connectionName ?? 'No connection'}
      </span>
      {database && <span>{database}</span>}
      <span className={styles.spacer}>{nodeStatus ?? ''}</span>
    </div>
  );
}
