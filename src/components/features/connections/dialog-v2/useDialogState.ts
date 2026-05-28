import type { Connection, AuthMode } from '../../../../connection/model';
import type { GlobalPrefs } from '../../../../connection/overrides';
import type { SecretSlot, TestResult, BuildStage } from '../../../../connection/ipc';

export type DialogState = {
  draft: Connection;
  initial: Connection | null;
  secrets: Partial<Record<SecretSlot, string>>;
  testResult:
    | null
    | { kind: 'pending' }
    | { kind: 'ok'; serverInfo: unknown }
    | { kind: 'fail'; stage: BuildStage; error: string };
  globals: GlobalPrefs;
};

export type DialogAction =
  | { type: 'set-field'; path: string; value: unknown }
  | { type: 'set-auth-kind'; kind: AuthMode['kind'] }
  | { type: 'set-target-kind'; kind: 'uri' | 'direct' }
  | { type: 'set-secret'; slot: SecretSlot; value: string }
  | { type: 'test-start' }
  | { type: 'test-result'; result: TestResult };

export function initialDialogState(seed: Connection | null, globals: GlobalPrefs): DialogState {
  const empty: Connection = {
    id: '', name: '',
    target: { kind: 'direct', host: 'localhost', port: 27017 },
    auth: { kind: 'none' },
    createdAt: new Date().toISOString(),
  };
  return {
    draft: seed ?? empty,
    initial: seed,
    secrets: {},
    testResult: null,
    globals,
  };
}

function authBlank(kind: AuthMode['kind']): AuthMode {
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

/** Sets a nested field by dot-path, returning a new object. */
function setByPath<T extends object>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = { ...obj };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = { ...cur[parts[i]] };
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return out;
}

export function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'set-field':
      // Whole-replace escape hatch: path === '' means replace the entire draft
      // with `value`. Used by tab forms that need to swap a whole sub-tree.
      if (action.path === '') {
        return { ...state, draft: action.value as Connection };
      }
      return { ...state, draft: setByPath(state.draft, action.path, action.value) };
    case 'set-auth-kind':
      return { ...state, draft: { ...state.draft, auth: authBlank(action.kind) } };
    case 'set-target-kind':
      return {
        ...state,
        draft: {
          ...state.draft,
          target: action.kind === 'direct'
            ? { kind: 'direct', host: '', port: 27017 }
            : { kind: 'uri', uri: '' },
        },
      };
    case 'set-secret':
      return { ...state, secrets: { ...state.secrets, [action.slot]: action.value } };
    case 'test-start':
      return { ...state, testResult: { kind: 'pending' } };
    case 'test-result':
      return {
        ...state,
        testResult: action.result.ok
          ? { kind: 'ok', serverInfo: action.result.serverInfo }
          : { kind: 'fail', stage: action.result.stage, error: action.result.error },
      };
  }
}
