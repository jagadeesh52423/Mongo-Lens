import { FormField } from '../../../../../ui/FormField';
import type { AuthSubFormProps } from './registry';

export function KerberosForm({ value, onChange }: AuthSubFormProps) {
  if (value.auth.kind !== 'kerberos') return null;
  const auth = value.auth;
  return (
    <>
      <p>Kerberos requires MongoDB Enterprise and the gssapi-auth cargo feature.</p>
      <FormField>
        <FormField.Label htmlFor="krb-principal">Principal</FormField.Label>
        <FormField.Input
          id="krb-principal"
          value={auth.principal}
          placeholder="user@REALM"
          onChange={(e) => onChange({ ...value, auth: { ...auth, principal: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="krb-service">Service name (optional)</FormField.Label>
        <FormField.Input
          id="krb-service"
          value={auth.serviceName ?? ''}
          placeholder="mongodb"
          onChange={(e) => onChange({ ...value, auth: { ...auth, serviceName: e.target.value || undefined } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="krb-canon">
          <input
            id="krb-canon"
            type="checkbox"
            checked={!!auth.canonicalizeHostName}
            onChange={(e) => onChange({ ...value, auth: { ...auth, canonicalizeHostName: e.target.checked || undefined } })}
          />
          {' '}Canonicalize host name
        </FormField.Label>
      </FormField>
    </>
  );
}
