import { FormField } from '../../../../../ui/FormField';
import { FilePicker } from '../shared/FilePicker';
import type { AuthSubFormProps } from '../auth/registry';

export function KeyForm({ value, onChange, secrets, onSecretChange }: AuthSubFormProps) {
  if (!value.ssh || value.ssh.auth.kind !== 'key') return null;
  const ssh = value.ssh;
  const auth = ssh.auth;
  const editingExisting = !!value.id;
  return (
    <>
      <FilePicker
        id="ssh-keypath"
        label="Private key file"
        value={auth.keyPath}
        onChange={(path) => onChange({ ...value, ssh: { ...ssh, auth: { ...auth, keyPath: path ?? '' } } })}
      />
      <label>
        <input
          type="checkbox"
          checked={auth.hasPassphrase}
          onChange={(e) => onChange({ ...value, ssh: { ...ssh, auth: { ...auth, hasPassphrase: e.target.checked } } })}
        />
        {' '}Key requires passphrase
      </label>
      {auth.hasPassphrase && (
        <FormField>
          <FormField.Label htmlFor="ssh-pass">Passphrase</FormField.Label>
          <FormField.Input
            id="ssh-pass"
            type="password"
            value={secrets['ssh-key-passphrase'] ?? ''}
            placeholder={editingExisting && secrets['ssh-key-passphrase'] === undefined ? '(stored in Keychain — leave blank to keep)' : ''}
            onChange={(e) => onSecretChange('ssh-key-passphrase', e.target.value)}
          />
        </FormField>
      )}
    </>
  );
}
