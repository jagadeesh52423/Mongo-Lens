import { FormField } from '../../../../../ui/FormField';
import type { SubFormProps } from '../types';

export function AwsIamForm({ value, onChange, secrets, onSecretChange }: SubFormProps) {
  if (value.auth.kind !== 'aws-iam') return null;
  const auth = value.auth;
  return (
    <>
      <FormField>
        <FormField.Label htmlFor="aws-akid">Access key ID</FormField.Label>
        <FormField.Input
          id="aws-akid"
          value={auth.accessKeyId ?? ''}
          onChange={(e) => onChange({ ...value, auth: { ...auth, accessKeyId: e.target.value || undefined } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="aws-secret">Secret access key</FormField.Label>
        <FormField.Input
          id="aws-secret"
          type="password"
          value={secrets['aws-secret-key'] ?? ''}
          onChange={(e) => onSecretChange('aws-secret-key', e.target.value)}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="aws-session">Session token (optional)</FormField.Label>
        <FormField.Input
          id="aws-session"
          value={auth.sessionToken ?? ''}
          onChange={(e) => onChange({ ...value, auth: { ...auth, sessionToken: e.target.value || undefined } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="aws-envcreds">
          <input
            id="aws-envcreds"
            type="checkbox"
            checked={!!auth.useEnvCreds}
            onChange={(e) => onChange({ ...value, auth: { ...auth, useEnvCreds: e.target.checked || undefined } })}
          />
          {' '}Use AWS environment credentials
        </FormField.Label>
      </FormField>
    </>
  );
}
