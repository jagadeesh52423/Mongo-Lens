import type { TabFormProps } from './types';
import type { Proxy } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import { SegmentedControl } from '../../../../ui';
import { BLANK_PROXY } from '../../../../../connection/feature-state';
import styles from './ProxyTab.module.css';

const KIND_OPTIONS = [
  { value: 'socks5', label: 'SOCKS5' },
  { value: 'http', label: 'HTTP' },
  { value: 'socks4', label: 'SOCKS4' },
] as const;

export function ProxyTab({ value, onChange, secrets, onSecretChange }: TabFormProps) {
  const proxy: Proxy = value.proxy ?? BLANK_PROXY;

  function setProxy(next: Proxy) {
    onChange({ ...value, proxy: next });
  }

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={proxy.enabled}
          onChange={(e) => setProxy({ ...proxy, enabled: e.target.checked })}
        />
        Enable proxy
      </label>

      <div className={proxy.enabled ? styles.fields : styles.fieldsDim}>
        <SegmentedControl
          ariaLabel="Proxy type"
          value={proxy.kind}
          options={KIND_OPTIONS as unknown as { value: Proxy['kind']; label: string }[]}
          onChange={(kind) => setProxy({ ...proxy, kind })}
        />

        {proxy.kind !== 'socks5' && (
          <div role="alert" className={styles.warning}>
            Only SOCKS5 is supported by the MongoDB driver. {proxy.kind.toUpperCase()} will fail at connect time.
          </div>
        )}

        <div className={styles.fieldRow}>
          <FormField>
            <FormField.Label htmlFor="proxy-host">Host</FormField.Label>
            <FormField.Input
              id="proxy-host"
              className={styles.mono}
              value={proxy.host}
              onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
            />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="proxy-port">Port</FormField.Label>
            <FormField.Input
              id="proxy-port"
              type="number"
              className={styles.mono}
              value={proxy.port}
              onChange={(e) => setProxy({ ...proxy, port: Number(e.target.value) })}
            />
          </FormField>
        </div>

        <FormField>
          <FormField.Label htmlFor="proxy-user">Username (optional)</FormField.Label>
          <FormField.Input
            id="proxy-user"
            value={proxy.auth?.username ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              if (next) {
                setProxy({ ...proxy, auth: { username: next } });
              } else {
                // Clear the orphan keychain slot so we don't persist a
                // password the user can no longer see or edit.
                onSecretChange('proxy-password', '');
                setProxy({ ...proxy, auth: undefined });
              }
            }}
          />
        </FormField>

        {proxy.auth && (
          <FormField>
            <FormField.Label htmlFor="proxy-pw">Password</FormField.Label>
            <FormField.Input
              id="proxy-pw"
              type="password"
              value={secrets['proxy-password'] ?? ''}
              onChange={(e) => onSecretChange('proxy-password', e.target.value)}
            />
          </FormField>
        )}
      </div>
    </>
  );
}
