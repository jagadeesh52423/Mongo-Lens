import { FormField } from '../../../../../ui/FormField';
import type { AuthSubFormProps } from './registry';

export function LdapForm({ value, onChange, secrets, onSecretChange }: AuthSubFormProps) {
  if (value.auth.kind !== 'ldap') return null;
  const auth = value.auth;
  const editingExisting = !!value.id;
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
          placeholder={editingExisting && secrets['auth-password'] === undefined ? '(stored in Keychain — leave blank to keep)' : ''}
          onChange={(e) => onSecretChange('auth-password', e.target.value)}
        />
      </FormField>
    </>
  );
}
