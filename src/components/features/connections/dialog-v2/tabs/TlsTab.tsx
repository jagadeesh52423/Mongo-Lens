import type { TabFormProps } from './types';
import type { Tls } from '../../../../../connection/model';
import { FilePicker } from './shared/FilePicker';
import styles from './TlsTab.module.css';

const BLANK_TLS_DISABLED: Tls = { enabled: false };

export function TlsTab({ value, onChange }: TabFormProps) {
  const tls = value.tls ?? BLANK_TLS_DISABLED;
  // Widen to read the optional cert fields regardless of which union arm is
  // active, so disabled-but-filled data survives across the enable toggle.
  const x = tls as Extract<Tls, { enabled: true }>;

  function setTls(next: Tls) {
    onChange({ ...value, tls: next });
  }

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={tls.enabled}
          onChange={(e) => setTls({ ...x, enabled: e.target.checked } as Tls)}
        />
        Enable TLS
      </label>

      <div className={tls.enabled ? styles.fields : styles.fieldsDim}>
        <FilePicker
          id="tls-ca"
          label="CA certificate (PEM)"
          value={x.caFile}
          onChange={(path) => setTls({ ...x, enabled: tls.enabled, caFile: path } as Tls)}
          filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
        />
        <FilePicker
          id="tls-clientcert"
          label="Client certificate (PEM)"
          value={x.clientCertFile}
          onChange={(path) => setTls({ ...x, enabled: tls.enabled, clientCertFile: path } as Tls)}
          filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
        />
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={!!x.allowInvalidCerts}
            onChange={(e) => setTls({ ...x, enabled: tls.enabled, allowInvalidCerts: e.target.checked } as Tls)}
          />
          Allow invalid certificates (insecure)
        </label>
        {x.allowInvalidCerts && (
          <div role="alert" className={styles.warning}>
            ⚠ Server certificate validation is disabled. Use only for trusted internal hosts.
          </div>
        )}
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={!!x.allowInvalidHostnames}
            onChange={(e) => setTls({ ...x, enabled: tls.enabled, allowInvalidHostnames: e.target.checked } as Tls)}
          />
          Allow invalid hostnames
        </label>
      </div>
    </>
  );
}
