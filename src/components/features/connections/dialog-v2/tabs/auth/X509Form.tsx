import { FormField } from '../../../../../ui/FormField';
import type { AuthSubFormProps } from './registry';

// X.509 client-cert auth. Task 8 will introduce a FilePicker shared
// component; for now we accept a plain path string. Once FilePicker lands,
// swap the inputs for <FilePicker /> with no other changes.
export function X509Form({ value, onChange }: AuthSubFormProps) {
  if (value.auth.kind !== 'x509') return null;
  const auth = value.auth;
  return (
    <>
      <FormField>
        <FormField.Label htmlFor="x509-cert">Client certificate file</FormField.Label>
        <FormField.Input
          id="x509-cert"
          value={auth.certFile}
          placeholder="/path/to/client.pem"
          onChange={(e) => onChange({ ...value, auth: { ...auth, certFile: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="x509-certkey">Client key file (optional)</FormField.Label>
        <FormField.Input
          id="x509-certkey"
          value={auth.certKeyFile ?? ''}
          placeholder="/path/to/client.key"
          onChange={(e) => onChange({ ...value, auth: { ...auth, certKeyFile: e.target.value || undefined } })}
        />
      </FormField>
    </>
  );
}
