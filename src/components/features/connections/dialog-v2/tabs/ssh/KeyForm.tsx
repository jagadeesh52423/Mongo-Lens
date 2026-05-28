import { FormField } from '../../../../../ui/FormField';
import { FilePicker } from '../shared/FilePicker';
import type { SubFormProps } from '../types';

export function KeyForm({ value, onChange, secrets, onSecretChange }: SubFormProps) {
  const ssh = value.ssh;
  // `ssh.auth` is a discriminated union; this guard narrows it to the
  // `'key'` variant for the rest of the body. The local `auth` alias is
  // re-narrowed in the same expression so TS preserves the shape across
  // the binding (which it otherwise loses through `const auth = ssh.auth`).
  if (!ssh || ssh.auth.kind !== 'key') return null;
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
