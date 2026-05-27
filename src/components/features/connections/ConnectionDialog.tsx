import { useState } from 'react';
import type { Connection, ConnectionInput } from '../../../types';
import { Button, Dialog, FormField } from '../../ui';
import styles from './ConnectionDialog.module.css';

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

  return (
    <Dialog open onClose={onCancel} ariaLabel="Connection Dialog" width={520}>
      <Dialog.Header
        title={initial ? 'Edit Connection' : 'New Connection'}
        onClose={onCancel}
      />
      <Dialog.Body>
        <div className={styles.grid}>
          <div className={styles.span2}>
            <FormField>
              <FormField.Label htmlFor="conn-name">Name</FormField.Label>
              <FormField.Input
                id="conn-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </FormField>
          </div>
          <FormField>
            <FormField.Label htmlFor="conn-host">Host</FormField.Label>
            <FormField.Input id="conn-host" value={host} onChange={(e) => setHost(e.target.value)} />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="conn-port">Port</FormField.Label>
            <FormField.Input id="conn-port" value={port} onChange={(e) => setPort(e.target.value)} />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="conn-authdb">Auth DB</FormField.Label>
            <FormField.Input id="conn-authdb" value={authDb} onChange={(e) => setAuthDb(e.target.value)} />
          </FormField>
          <div />
          <FormField>
            <FormField.Label htmlFor="conn-username">Username</FormField.Label>
            <FormField.Input
              id="conn-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="conn-password">Password</FormField.Label>
            <FormField.Input
              id="conn-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={initial ? '(unchanged)' : ''}
            />
          </FormField>
          <div className={styles.span2}>
            <FormField>
              <FormField.Label htmlFor="conn-connstring">
                Connection String (overrides above if set)
              </FormField.Label>
              <div className={styles.mono}>
                <FormField.Input
                  id="conn-connstring"
                  value={connString}
                  onChange={(e) => setConnString(e.target.value)}
                  placeholder="mongodb+srv://..."
                />
              </div>
            </FormField>
          </div>
        </div>
        <details className={styles.ssh}>
          <summary>SSH Tunnel (optional)</summary>
          <div className={styles.grid}>
            <FormField>
              <FormField.Label htmlFor="conn-sshhost">SSH Host</FormField.Label>
              <FormField.Input
                id="conn-sshhost"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
              />
            </FormField>
            <FormField>
              <FormField.Label htmlFor="conn-sshport">SSH Port</FormField.Label>
              <FormField.Input
                id="conn-sshport"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
              />
            </FormField>
            <FormField>
              <FormField.Label htmlFor="conn-sshuser">SSH User</FormField.Label>
              <FormField.Input
                id="conn-sshuser"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
              />
            </FormField>
            <FormField>
              <FormField.Label htmlFor="conn-sshkey">SSH Key Path</FormField.Label>
              <FormField.Input
                id="conn-sshkey"
                value={sshKeyPath}
                onChange={(e) => setSshKeyPath(e.target.value)}
              />
            </FormField>
          </div>
        </details>
        {err && (
          <div className={styles.errorWrap}>
            <FormField.Error>{err}</FormField.Error>
          </div>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
