import { FormField } from '../../../../../ui/FormField';
import type { SubFormProps } from '../types';

export function LdapForm({ value, onChange, secrets, onSecretChange }: SubFormProps) {
  if (value.auth.kind !== 'ldap') return null;
  const auth = value.auth;
  return (
    <>
      <p>LDAP requires MongoDB Enterprise.</p>
      <FormField>
        <FormField.Label htmlFor="ldap-user">Username</FormField.Label>
        <FormField.Input
          id="ldap-user"
          value={auth.username}
          onChange={(e) => onChange({ ...value, auth: { ...auth, username: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="ldap-pw">Password</FormField.Label>
        <FormField.Input
          id="ldap-pw"
          type="password"
          value={secrets['auth-password'] ?? ''}
          onChange={(e) => onSecretChange('auth-password', e.target.value)}
        />
      </FormField>
    </>
  );
}
