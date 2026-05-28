import { FormField } from '../../../../../ui/FormField';
import type { SubFormProps } from '../types';

type ScramMechanism = 'SCRAM-SHA-1' | 'SCRAM-SHA-256' | 'auto';

export function ScramForm({ value, onChange, secrets, onSecretChange }: SubFormProps) {
  if (value.auth.kind !== 'scram') return null;
  const auth = value.auth;
  const editingExisting = !!value.id;
  return (
    <>
      <FormField>
        <FormField.Label htmlFor="scram-user">Username</FormField.Label>
        <FormField.Input
          id="scram-user"
          value={auth.username}
          onChange={(e) => onChange({ ...value, auth: { ...auth, username: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="scram-pw">Password</FormField.Label>
        <FormField.Input
          id="scram-pw"
          type="password"
          value={secrets['auth-password'] ?? ''}
          placeholder={editingExisting && secrets['auth-password'] === undefined ? '(stored in Keychain — leave blank to keep)' : ''}
          onChange={(e) => onSecretChange('auth-password', e.target.value)}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="scram-authdb">Auth DB</FormField.Label>
        <FormField.Input
          id="scram-authdb"
          value={auth.authDb}
          onChange={(e) => onChange({ ...value, auth: { ...auth, authDb: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="scram-mech">Mechanism</FormField.Label>
        <select
          id="scram-mech"
          value={auth.mechanism ?? 'auto'}
          onChange={(e) => onChange({ ...value, auth: { ...auth, mechanism: e.target.value as ScramMechanism } })}
        >
          <option value="auto">Auto-negotiate</option>
          <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
          <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
        </select>
      </FormField>
    </>
  );
}
