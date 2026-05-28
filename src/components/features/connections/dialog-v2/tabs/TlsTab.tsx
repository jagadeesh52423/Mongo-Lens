import type { TabFormProps } from './types';
import type { Tls } from '../../../../../connection/model';
import { FilePicker } from './shared/FilePicker';
import styles from './TlsTab.module.css';

export function TlsTab({ value, onChange }: TabFormProps) {
  const tls = value.tls;
  const enabled = !!tls?.enabled;

  function setTls(next: Tls | undefined) {
    onChange({ ...value, tls: next });
  }

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setTls(e.target.checked ? { enabled: true } : { enabled: false })}
        />
        Enable TLS
      </label>

      {enabled && tls?.enabled && (
        <>
          <FilePicker
            id="tls-ca"
            label="CA certificate (PEM)"
            value={tls.caFile}
            onChange={(path) => setTls({ ...tls, caFile: path })}
            filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
          />
          <FilePicker
            id="tls-clientcert"
            label="Client certificate (PEM)"
            value={tls.clientCertFile}
            onChange={(path) => setTls({ ...tls, clientCertFile: path })}
            filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
          />
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={!!tls.allowInvalidCerts}
              onChange={(e) => setTls({ ...tls, allowInvalidCerts: e.target.checked })}
            />
            Allow invalid certificates (insecure)
          </label>
          {tls.allowInvalidCerts && (
            <div role="alert" className={styles.warning}>
              ⚠ Server certificate validation is disabled. Use only for trusted internal hosts.
            </div>
          )}
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={!!tls.allowInvalidHostnames}
              onChange={(e) => setTls({ ...tls, allowInvalidHostnames: e.target.checked })}
            />
            Allow invalid hostnames
          </label>
        </>
      )}
    </>
  );
}
