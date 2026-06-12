import { FormField } from '../../../../../ui/FormField';
import { PasswordField } from '../../../../../ui/PasswordField';
import type { SubFormProps } from '../types';

export function PasswordForm({ value, secrets, onSecretChange }: SubFormProps) {
  if (!value.ssh || value.ssh.auth.kind !== 'password') return null;
  return (
    <FormField>
      <FormField.Label htmlFor="ssh-pw">SSH password</FormField.Label>
      <PasswordField
        id="ssh-pw"
        value={secrets['ssh-password'] ?? ''}
        onChange={(e) => onSecretChange('ssh-password', e.target.value)}
      />
    </FormField>
  );
}
