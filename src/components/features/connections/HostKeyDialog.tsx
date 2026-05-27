interface HostKeyDialogProps {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Displays the SSH host key fingerprint and asks the user whether to trust it.
 * Shown when `connect_connection` returns `HostKeyUnknown`.
 * On accept the connection is retried with `acceptHostKey: true`, causing the
 * key to be persisted to the app's known_hosts file.
 */
export function HostKeyDialog({
  host,
  port,
  algorithm,
  fingerprint,
  onAccept,
  onReject,
}: HostKeyDialogProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 24, width: 440,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>Unknown SSH Host Key</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-dim)' }}>
          The authenticity of <strong>{host}:{port}</strong> cannot be established.
          Its {algorithm} key fingerprint is:
        </p>
        <code
          style={{
            display: 'block', padding: '8px 12px',
            background: 'var(--bg)', borderRadius: 4,
            fontSize: 12, wordBreak: 'break-all',
          }}
        >
          {fingerprint}
        </code>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-dim)' }}>
          Are you sure you want to connect? If you trust this host, the key will be
          saved and you will not be prompted again.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onReject}>Cancel</button>
          <button type="button" onClick={onAccept} style={{ color: 'var(--accent-red)' }}>
            Trust &amp; Connect
          </button>
        </div>
      </div>
    </div>
  );
}
