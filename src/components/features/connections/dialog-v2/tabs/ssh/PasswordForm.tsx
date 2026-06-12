import { FormField } from '../../../../../ui/FormField';
import type { SubFormProps } from '../types';

export function PasswordForm({ value, secrets, onSecretChange }: SubFormProps) {
  if (!value.ssh || value.ssh.auth.kind !== 'password') return null;
  return (
    <FormField>
      <FormField.Label htmlFor="ssh-pw">SSH password</FormField.Label>
      <FormField.Input
        id="ssh-pw"
        type="password"
        value={secrets['ssh-password'] ?? ''}
        onChange={(e) => onSecretChange('ssh-password', e.target.value)}
      />
    </FormField>
  );
}
