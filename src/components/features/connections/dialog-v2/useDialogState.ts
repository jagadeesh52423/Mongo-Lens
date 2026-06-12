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
  // Distinct from testResult — a backend save error must not fight a stale test result.
  saveError: string | null;
  globals: GlobalPrefs;
};

export type DialogAction =
  | { type: 'set-field'; path: string; value: unknown }
  | { type: 'set-auth-kind'; kind: AuthMode['kind'] }
  | { type: 'set-target-kind'; kind: 'uri' | 'direct' }
  | { type: 'set-secret'; slot: SecretSlot; value: string }
  | { type: 'test-start' }
  | { type: 'test-result'; result: TestResult }
  | { type: 'save-error'; message: string }
  | { type: 'save-clear' };

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
    saveError: null,
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
      // Any edit invalidates a prior test result — clearing avoids a stale
      // failure heading lingering in the footer after the user starts fixing
      // the offending field (PR-4 review finding #2).
      if (action.path === '') {
        return { ...state, draft: action.value as Connection, testResult: null, saveError: null };
      }
      return {
        ...state,
        draft: setByPath(state.draft, action.path, action.value),
        testResult: null,
        saveError: null,
      };
    case 'set-auth-kind':
      // Switching auth mode wipes the previous test result for the same
      // reason — the prior result was about a different auth shape.
      return {
        ...state,
        draft: { ...state.draft, auth: authBlank(action.kind) },
        testResult: null,
        saveError: null,
      };
    case 'set-target-kind':
      return {
        ...state,
        draft: {
          ...state.draft,
          target: action.kind === 'direct'
            ? { kind: 'direct', host: '', port: 27017 }
            : { kind: 'uri', uri: '' },
        },
        testResult: null,
      };
    case 'set-secret':
      // A secret edit also invalidates the test result (e.g. user is fixing
      // a wrong password after an auth-stage failure).
      return {
        ...state,
        secrets: { ...state.secrets, [action.slot]: action.value },
        testResult: null,
        saveError: null,
      };
    case 'test-start':
      return { ...state, testResult: { kind: 'pending' } };
    case 'test-result':
      return {
        ...state,
        testResult: action.result.ok
          ? { kind: 'ok', serverInfo: action.result.serverInfo }
          : { kind: 'fail', stage: action.result.stage, error: action.result.error },
      };
    case 'save-error':
      return { ...state, saveError: action.message };
    case 'save-clear':
      return { ...state, saveError: null };
  }
}
