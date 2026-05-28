import { FilePicker } from '../shared/FilePicker';
import type { SubFormProps } from '../types';

const PEM_FILTERS = [{ name: 'PEM', extensions: ['pem', 'crt'] }];

export function X509Form({ value, onChange }: SubFormProps) {
  if (value.auth.kind !== 'x509') return null;
  const auth = value.auth;
  return (
    <>
      <FilePicker
        id="x509-cert"
        label="Client certificate file"
        value={auth.certFile || undefined}
        onChange={(path) => onChange({ ...value, auth: { ...auth, certFile: path ?? '' } })}
        filters={PEM_FILTERS}
      />
      <FilePicker
        id="x509-certkey"
        label="Client key file (optional)"
        value={auth.certKeyFile}
        onChange={(path) => onChange({ ...value, auth: { ...auth, certKeyFile: path } })}
        filters={PEM_FILTERS}
      />
    </>
  );
}
