import type { TabFormProps } from './types';
import type { Proxy } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import styles from './ProxyTab.module.css';

const PROXY_KINDS = ['socks5', 'http', 'socks4'] as const;

export function ProxyTab({ value, onChange, secrets, onSecretChange }: TabFormProps) {
  const proxy = value.proxy;
  const editingExisting = !!value.id;

  function setProxy(next: Proxy | undefined) {
    onChange({ ...value, proxy: next });
  }

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={!!proxy}
          onChange={(e) =>
            setProxy(e.target.checked ? { kind: 'socks5', host: '', port: 1080 } : undefined)
          }
        />
        Enable proxy
      </label>

      {proxy && (
        <>
          <div role="radiogroup" aria-label="Proxy type" className={styles.radioGroup}>
            {PROXY_KINDS.map((kind) => (
              <label key={kind}>
                <input
                  type="radio"
                  name="proxy-kind"
                  checked={proxy.kind === kind}
                  onChange={() => setProxy({ ...proxy, kind })}
                />
                {' '}{kind.toUpperCase()}
              </label>
            ))}
          </div>

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
                value={proxy.host}
                onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
              />
            </FormField>
            <FormField>
              <FormField.Label htmlFor="proxy-port">Port</FormField.Label>
              <FormField.Input
                id="proxy-port"
                type="number"
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
              onChange={(e) =>
                setProxy({ ...proxy, auth: e.target.value ? { username: e.target.value } : undefined })
              }
            />
          </FormField>

          {proxy.auth && (
            <FormField>
              <FormField.Label htmlFor="proxy-pw">Password</FormField.Label>
              <FormField.Input
                id="proxy-pw"
                type="password"
                value={secrets['proxy-password'] ?? ''}
                placeholder={editingExisting && secrets['proxy-password'] === undefined ? '(stored in Keychain — leave blank to keep)' : ''}
                onChange={(e) => onSecretChange('proxy-password', e.target.value)}
              />
            </FormField>
          )}
        </>
      )}
    </>
  );
}
