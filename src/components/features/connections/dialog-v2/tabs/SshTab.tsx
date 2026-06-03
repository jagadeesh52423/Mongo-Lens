import type { TabFormProps } from './types';
import type { SshAuth, SshTunnel } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import { SegmentedControl } from '../../../../ui';
import { SSH_AUTH_FORMS, SSH_AUTH_LABELS } from './ssh/registry';
import { BLANK_SSH } from '../../../../../connection/feature-state';
import styles from './SshTab.module.css';

function blankSshAuth(kind: SshAuth['kind']): SshAuth {
  switch (kind) {
    case 'password': return { kind: 'password' };
    case 'key': return { kind: 'key', keyPath: '', hasPassphrase: false };
    case 'agent': return { kind: 'agent' };
  }
}

export function SshTab(props: TabFormProps) {
  const { value, onChange } = props;
  const ssh: SshTunnel = value.ssh ?? BLANK_SSH;

  function setSsh(next: SshTunnel) {
    onChange({ ...value, ssh: next });
  }

  const SubForm = SSH_AUTH_FORMS[ssh.auth.kind];
  const authOptions = (Object.keys(SSH_AUTH_LABELS) as SshAuth['kind'][])
    .map((kind) => ({ value: kind, label: SSH_AUTH_LABELS[kind] }));

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={ssh.enabled}
          onChange={(e) => setSsh({ ...ssh, enabled: e.target.checked })}
        />
        Enable SSH tunnel
      </label>

      <div className={ssh.enabled ? styles.fields : styles.fieldsDim}>
        <div className={styles.fieldRow}>
          <FormField>
            <FormField.Label htmlFor="ssh-host">SSH host</FormField.Label>
            <FormField.Input
              id="ssh-host"
              className={styles.mono}
              value={ssh.host}
              onChange={(e) => setSsh({ ...ssh, host: e.target.value })}
            />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="ssh-port">SSH port</FormField.Label>
            <FormField.Input
              id="ssh-port"
              type="number"
              className={styles.mono}
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

        <SegmentedControl
          ariaLabel="SSH auth method"
          value={ssh.auth.kind}
          options={authOptions}
          onChange={(kind) => setSsh({ ...ssh, auth: blankSshAuth(kind) })}
        />

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
      </div>
    </>
  );
}
