import { useState } from 'react';
import type { Connection, ConnectionInput } from '../../../types';

interface Props {
  initial?: Connection;
  onSave: (input: ConnectionInput) => Promise<void>;
  onCancel: () => void;
}

export function ConnectionDialog({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [host, setHost] = useState(initial?.host ?? 'localhost');
  const [port, setPort] = useState(String(initial?.port ?? 27017));
  const [authDb, setAuthDb] = useState(initial?.authDb ?? 'admin');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const [connString, setConnString] = useState(initial?.connString ?? '');
  const [sshHost, setSshHost] = useState(initial?.sshHost ?? '');
  const [sshPort, setSshPort] = useState(String(initial?.sshPort ?? ''));
  const [sshUser, setSshUser] = useState(initial?.sshUser ?? '');
  const [sshKeyPath, setSshKeyPath] = useState(initial?.sshKeyPath ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        host: host || undefined,
        port: port ? Number(port) : undefined,
        authDb: authDb || undefined,
        username: username || undefined,
        password: password || undefined,
        connString: connString || undefined,
        sshHost: sshHost || undefined,
        sshPort: sshPort ? Number(sshPort) : undefined,
        sshUser: sshUser || undefined,
        sshKeyPath: sshKeyPath || undefined,
      });
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = (t: string) => (
    <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginBottom: 2 }}>{t}</div>
  );

  return (
    <div
      role="dialog"
      aria-label="Connection Dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 20,
          width: 520,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 14px' }}>{initial ? 'Edit Connection' : 'New Connection'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            {label('Name')}
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Host')}
            <input value={host} onChange={(e) => setHost(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Port')}
            <input value={port} onChange={(e) => setPort(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Auth DB')}
            <input value={authDb} onChange={(e) => setAuthDb(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div />
          <div>
            {label('Username')}
            <input value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%' }}
              placeholder={initial ? '(unchanged)' : ''}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            {label('Connection String (overrides above if set)')}
            <input
              value={connString}
              onChange={(e) => setConnString(e.target.value)}
              style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
              placeholder="mongodb+srv://..."
            />
          </div>
          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
            <strong style={{ fontSize: 12 }}>SSH Tunnel (optional)</strong>
          </div>
          <div>
            {label('SSH Host')}
            <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('SSH Port')}
            <input value={sshPort} onChange={(e) => setSshPort(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('SSH User')}
            <input value={sshUser} onChange={(e) => setSshUser(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('SSH Key Path')}
            <input value={sshKeyPath} onChange={(e) => setSshKeyPath(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        {err && <div style={{ color: 'var(--accent-red)', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
