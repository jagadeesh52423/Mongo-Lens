import type { ComponentType } from 'react';
import type { AuthMode } from '../../../../../../connection/model';
import type { TabFormProps } from '../types';
import { NoneForm } from './NoneForm';
import { ScramForm } from './ScramForm';
import { LegacyCrForm } from './LegacyCrForm';
import { X509Form } from './X509Form';
import { LdapForm } from './LdapForm';
import { KerberosForm } from './KerberosForm';
import { AwsIamForm } from './AwsIamForm';
import { OidcForm } from './OidcForm';

export interface AuthSubFormProps extends TabFormProps {
  // value.auth is the active variant; each sub-form narrows by `kind`.
}

/**
 * Auth-mode sub-form registry.
 *
 * To add a new AuthMode variant:
 *   1. Add the variant to `AuthMode` in src/connection/model.ts and its Rust mirror.
 *   2. Implement <Variant>Form.tsx alongside the existing forms.
 *   3. Register here under AUTH_FORMS + add a human label to AUTH_LABELS.
 * No edits needed elsewhere.
 */
export const AUTH_FORMS: Record<AuthMode['kind'], ComponentType<AuthSubFormProps>> = {
  'none': NoneForm,
  'scram': ScramForm,
  'legacy-cr': LegacyCrForm,
  'x509': X509Form,
  'ldap': LdapForm,
  'kerberos': KerberosForm,
  'aws-iam': AwsIamForm,
  'oidc': OidcForm,
};

export const AUTH_LABELS: Record<AuthMode['kind'], string> = {
  'none': 'No authentication',
  'scram': 'SCRAM (username + password)',
  'legacy-cr': 'Legacy MONGODB-CR',
  'x509': 'X.509 client certificate',
  'ldap': 'LDAP (PLAIN)',
  'kerberos': 'Kerberos (GSSAPI)',
  'aws-iam': 'AWS IAM',
  'oidc': 'OIDC',
};
