interface Props {
  connectionName?: string;
  database?: string;
  nodeStatus?: string;
}

export function StatusBar({ connectionName, database, nodeStatus }: Props) {
  return (
    <div
      style={{
        height: 22,
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        fontSize: 11,
        color: 'var(--fg-dim)',
        gap: 14,
      }}
    >
      <span>
        <span style={{ color: connectionName ? 'var(--accent-green)' : 'var(--fg-dim)' }}>
          ●
        </span>{' '}
        {connectionName ?? 'No connection'}
      </span>
      {database && <span>{database}</span>}
      <span style={{ marginLeft: 'auto' }}>{nodeStatus ?? ''}</span>
    </div>
  );
}
