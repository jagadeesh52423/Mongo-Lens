import { FormField } from '../../../../../ui/FormField';
import { PasswordField } from '../../../../../ui/PasswordField';
import type { SubFormProps } from '../types';

export function LegacyCrForm({ value, onChange, secrets, onSecretChange }: SubFormProps) {
  if (value.auth.kind !== 'legacy-cr') return null;
  const auth = value.auth;
  return (
    <>
      <p>⚠ Legacy MONGODB-CR is deprecated; use SCRAM for new deployments.</p>
      <FormField>
        <FormField.Label htmlFor="cr-user">Username</FormField.Label>
        <FormField.Input
          id="cr-user"
          value={auth.username}
          onChange={(e) => onChange({ ...value, auth: { ...auth, username: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="cr-pw">Password</FormField.Label>
        <PasswordField
          id="cr-pw"
          value={secrets['auth-password'] ?? ''}
          onChange={(e) => onSecretChange('auth-password', e.target.value)}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="cr-authdb">Auth DB</FormField.Label>
        <FormField.Input
          id="cr-authdb"
          value={auth.authDb}
          onChange={(e) => onChange({ ...value, auth: { ...auth, authDb: e.target.value } })}
        />
      </FormField>
    </>
  );
}
