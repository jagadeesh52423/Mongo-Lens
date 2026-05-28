import type { TabFormProps } from './types';
import type { AuthMode } from '../../../../../connection/model';
import { AUTH_FORMS, AUTH_LABELS } from './auth/registry';

// Duplicated from useDialogState.ts. Acceptable for clarity in PR 2;
// can be hoisted to a shared utility in PR 3 if a third caller appears.
function blankAuth(kind: AuthMode['kind']): AuthMode {
  switch (kind) {
    case 'none': return { kind: 'none' };
    case 'scram': return { kind: 'scram', username: '', authDb: 'admin', mechanism: 'auto' };
    case 'legacy-cr': return { kind: 'legacy-cr', username: '', authDb: 'admin' };
    case 'x509': return { kind: 'x509', certFile: '' };
    case 'ldap': return { kind: 'ldap', username: '' };
    case 'kerberos': return { kind: 'kerberos', principal: '' };
    case 'aws-iam': return { kind: 'aws-iam' };
    case 'oidc': return { kind: 'oidc' };
  }
}

export function AuthTab(props: TabFormProps) {
  const SubForm = AUTH_FORMS[props.value.auth.kind];
  return (
    <>
      <label htmlFor="auth-kind">Authentication mode</label>
      <select
        id="auth-kind"
        value={props.value.auth.kind}
        onChange={(e) => {
          const kind = e.target.value as AuthMode['kind'];
          props.onChange({ ...props.value, auth: blankAuth(kind) });
        }}
      >
        {Object.entries(AUTH_LABELS).map(([kind, label]) => (
          <option key={kind} value={kind}>{label}</option>
        ))}
      </select>
      <SubForm {...props} />
    </>
  );
}
