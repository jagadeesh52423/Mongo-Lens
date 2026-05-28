import type { TabFormProps } from './types';
import type { AuthMode } from '../../../../../connection/model';
import { AUTH_FORMS, AUTH_LABELS } from './auth/registry';

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
          // The dialog shell passes onAuthKindChange wired to the reducer's
          // `set-auth-kind` action, which is the single source of truth for
          // variant-switch defaults (see useDialogState.ts::authBlank).
          props.onAuthKindChange?.(kind);
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
