import { FormField } from '../../../../../ui/FormField';
import type { AuthSubFormProps } from './registry';

export function OidcForm({ value, onChange }: AuthSubFormProps) {
  if (value.auth.kind !== 'oidc') return null;
  const auth = value.auth;
  return (
    <>
      <p>OIDC requires MongoDB Enterprise.</p>
      <FormField>
        <FormField.Label htmlFor="oidc-principal">Principal (optional)</FormField.Label>
        <FormField.Input
          id="oidc-principal"
          value={auth.principal ?? ''}
          onChange={(e) => onChange({ ...value, auth: { ...auth, principal: e.target.value || undefined } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="oidc-provider">Provider name (optional)</FormField.Label>
        <FormField.Input
          id="oidc-provider"
          value={auth.providerName ?? ''}
          onChange={(e) => onChange({ ...value, auth: { ...auth, providerName: e.target.value || undefined } })}
        />
      </FormField>
    </>
  );
}
