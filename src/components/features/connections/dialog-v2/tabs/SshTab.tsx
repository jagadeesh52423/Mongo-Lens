import type { TabFormProps } from './types';
import type { SshAuth, SshTunnel } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import { SSH_AUTH_FORMS, SSH_AUTH_LABELS } from './ssh/registry';
import styles from './SshTab.module.css';

function blankSshAuth(kind: SshAuth['kind']): SshAuth {
  switch (kind) {
    case 'password': return { kind: 'password' };
    case 'key': return { kind: 'key', keyPath: '', hasPassphrase: false };
    case 'agent': return { kind: 'agent' };
  }
}

function defaultTunnel(): SshTunnel {
  return {
    host: '',
    port: 22,
    user: '',
    auth: { kind: 'password' },
    knownHostsPolicy: 'strict',
  };
}

export function SshTab(props: TabFormProps) {
  const { value, onChange } = props;
  const ssh = value.ssh;
  const enabled = !!ssh;

  function setSsh(next: SshTunnel | undefined) {
    onChange({ ...value, ssh: next });
  }

  const SubForm = ssh ? SSH_AUTH_FORMS[ssh.auth.kind] : null;

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setSsh(e.target.checked ? defaultTunnel() : undefined)}
        />
        Enable SSH tunnel
      </label>

      {ssh && (
        <>
          <div className={styles.fieldRow}>
            <FormField>
              <FormField.Label htmlFor="ssh-host">SSH host</FormField.Label>
              <FormField.Input
                id="ssh-host"
                value={ssh.host}
                onChange={(e) => setSsh({ ...ssh, host: e.target.value })}
              />
            </FormField>
            <FormField>
              <FormField.Label htmlFor="ssh-port">SSH port</FormField.Label>
              <FormField.Input
                id="ssh-port"
                type="number"
                value={ssh.port}
                onChange={(e) => setSsh({ ...ssh, port: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <FormField>
            <FormField.Label htmlFor="ssh-user">SSH user</FormField.Label>
            <FormField.Input
              id="ssh-user"
              value={ssh.user}
              onChange={(e) => setSsh({ ...ssh, user: e.target.value })}
            />
          </FormField>

          <div role="radiogroup" aria-label="SSH auth method" className={styles.radioGroup}>
            {(Object.keys(SSH_AUTH_LABELS) as SshAuth['kind'][]).map((kind) => (
              <label key={kind}>
                <input
                  type="radio"
                  name="ssh-auth-kind"
                  checked={ssh.auth.kind === kind}
                  onChange={() => setSsh({ ...ssh, auth: blankSshAuth(kind) })}
                />
                {' '}{SSH_AUTH_LABELS[kind]}
              </label>
            ))}
          </div>

          {SubForm && <SubForm {...props} />}

          <FormField>
            <FormField.Label htmlFor="ssh-known-hosts">Host key policy</FormField.Label>
            <select
              id="ssh-known-hosts"
              value={ssh.knownHostsPolicy}
              onChange={(e) => setSsh({ ...ssh, knownHostsPolicy: e.target.value as SshTunnel['knownHostsPolicy'] })}
            >
              <option value="strict">Strict (require known hosts entry)</option>
              <option value="add-and-trust">Add and trust on first use</option>
              <option value="accept-any">Accept any (insecure)</option>
            </select>
          </FormField>
        </>
      )}
    </>
  );
}
