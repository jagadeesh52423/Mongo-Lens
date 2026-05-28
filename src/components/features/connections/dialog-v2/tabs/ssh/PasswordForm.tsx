import { FormField } from '../../../../../ui/FormField';
import type { AuthSubFormProps } from '../auth/registry';

export function PasswordForm({ value, secrets, onSecretChange }: AuthSubFormProps) {
  if (!value.ssh || value.ssh.auth.kind !== 'password') return null;
  const editingExisting = !!value.id;
  return (
    <FormField>
      <FormField.Label htmlFor="ssh-pw">SSH password</FormField.Label>
      <FormField.Input
        id="ssh-pw"
        type="password"
        value={secrets['ssh-password'] ?? ''}
        placeholder={editingExisting && secrets['ssh-password'] === undefined ? '(stored in Keychain — leave blank to keep)' : ''}
        onChange={(e) => onSecretChange('ssh-password', e.target.value)}
      />
    </FormField>
  );
}
