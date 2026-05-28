# Connection Dialog Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the tabbed connection dialog that consumes the Phase 1 backend, then cut over (drop the old dialog, drop the `CONN_V2` env gate, rename `connections_v2 → connections`).

**Architecture:** Single source of truth tabbed dialog using a plugin-registry pattern (`TabSpec`); each tab is one component. Dialog state is a local reducer. ConnectionTree reads from a new `useConnectionsV2` zustand store backed by the v2 IPC. 5 PRs land sequentially on `main`; PRs 1–4 build the new dialog behind a `DIALOG_V2=1` dev escape hatch so the legacy dialog stays the user-facing default. PR 5 is the cut-over.

**Tech Stack:** React 18 / TypeScript / Zustand / Vite / Vitest + Testing Library (frontend). Tauri 2 / rusqlite (backend changes only in PR 5).

**Spec reference:** `docs/superpowers/specs/2026-05-28-connection-dialog-phase2-design.md`. When a contract detail is silent in this plan, defer to the spec.

**Predecessor:** Phase 1 (`docs/superpowers/specs/2026-05-28-connection-model-redesign-design.md`) — merged at 2967d38, tag `conn-v2-phase1`. Phase 2 builds on the IPC + types it shipped.

---

## File Structure (locked at plan time)

### New files (PR 1–4)

```
src/components/features/connections/dialog-v2/
├── ConnectionDialogV2.tsx          ← Shell: header, sidebar, footer; tab dispatch via registry
├── ConnectionDialogV2.module.css
├── useDialogState.ts               ← Reducer + validation aggregation
├── tabs/
│   ├── types.ts                    ← TabSpec + TabFormProps interfaces
│   ├── registry.ts                 ← Array<TabSpec> + extension contract doc
│   ├── ServerTab.tsx
│   ├── AuthTab.tsx                 ← Sub-registry per auth.kind (PR 2)
│   ├── auth/                       ← 8 sub-forms, one per AuthMode variant
│   │   ├── registry.ts
│   │   ├── NoneForm.tsx
│   │   ├── ScramForm.tsx
│   │   ├── LegacyCrForm.tsx
│   │   ├── X509Form.tsx
│   │   ├── LdapForm.tsx
│   │   ├── KerberosForm.tsx
│   │   ├── AwsIamForm.tsx
│   │   └── OidcForm.tsx
│   ├── TlsTab.tsx
│   ├── SshTab.tsx                  ← Sub-registry per ssh.auth.kind
│   ├── ssh/
│   │   ├── registry.ts
│   │   ├── PasswordForm.tsx
│   │   ├── KeyForm.tsx
│   │   └── AgentForm.tsx
│   ├── ProxyTab.tsx
│   ├── IntelliShellTab.tsx
│   ├── ToolsTab.tsx
│   ├── AdvancedTab.tsx
│   └── shared/
│       ├── OverrideRow.tsx         ← "Use global: <value>" + override input
│       ├── FilePicker.tsx          ← Wraps tauri-plugin-dialog for cert/key paths
│       └── ColorPicker.tsx         ← Header color tag dropdown
└── __tests__/                      ← One test file per source file
```

```
src/components/features/connections/
├── useConnectionsV2.ts             ← NEW — zustand store wrapping v2 IPC
├── ConnectionTree.tsx              ← MODIFIED — reads useConnectionsV2, renders color stripe
└── ConnectionPanel.tsx             ← MODIFIED — branches on DIALOG_V2 escape hatch
```

### Files removed in PR 5

- `src/components/features/connections/ConnectionDialog.tsx` (old)
- `src/components/features/connections/ConnectionDialog.module.css`
- `src/components/features/connections/__tests__/ConnectionDialog.test.tsx`
- `src/store/connections.ts` (legacy store)
- Legacy IPC commands in `src-tauri/src/commands/connection.rs`:
  `list_connections`, `create_connection`, `update_connection`,
  `delete_connection`, `test_connection`, `connect_connection`,
  `disconnect_connection`.

### Files kept (reused)

- `src/components/features/connections/PassphraseDialog.tsx` (no change)
- `src/components/features/connections/HostKeyDialog.tsx` (no change)
- `src/components/features/connections/ConnectionErrorDialog.tsx` (gets staged-error rendering in PR 4)

---

# PR 1 — Shell + state + ServerTab + ConnectionTree color stripe

End-to-end slice: dialog shell renders behind `DIALOG_V2=1` escape hatch, ServerTab works, save flows through `connections_v2_save`, tree shows color stripe. Old dialog still default.

## Task 1: useConnectionsV2 store + IPC wrappers smoke test

**Files:**
- Create: `src/components/features/connections/useConnectionsV2.ts`
- Create: `src/components/features/connections/__tests__/useConnectionsV2.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/components/features/connections/__tests__/useConnectionsV2.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { useConnectionsV2 } from '../useConnectionsV2';
import type { Connection } from '../../../../connection/model';

const sample: Connection = {
  id: 'a', name: 'Sample',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('useConnectionsV2', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it('refresh calls connections_v2_list and stores result', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([sample]);
    const { result } = renderHook(() => useConnectionsV2());
    await act(() => result.current.refresh());
    expect(invoke).toHaveBeenCalledWith('connections_v2_list');
    expect(result.current.connections).toEqual([sample]);
  });

  it('save calls connections_v2_save then refreshes', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(sample)            // save
      .mockResolvedValueOnce([sample]);         // refresh
    const { result } = renderHook(() => useConnectionsV2());
    const saved = await act(() => result.current.save({ connection: sample, secrets: [] }));
    expect(invoke).toHaveBeenNthCalledWith(1, 'connections_v2_save', { input: { connection: sample, secrets: [] } });
    expect(invoke).toHaveBeenNthCalledWith(2, 'connections_v2_list');
    expect(saved).toEqual(sample);
  });

  it('remove calls connections_v2_delete then refreshes', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useConnectionsV2());
    await act(() => result.current.remove('a'));
    expect(invoke).toHaveBeenNthCalledWith(1, 'connections_v2_delete', { id: 'a' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'connections_v2_list');
  });

  it('test calls connections_v2_test and returns result', async () => {
    const ok = { ok: true, serverInfo: { version: '7.0' } } as const;
    vi.mocked(invoke).mockResolvedValueOnce(ok);
    const { result } = renderHook(() => useConnectionsV2());
    const r = await act(() => result.current.test({ connection: sample, secrets: [] }));
    expect(invoke).toHaveBeenCalledWith('connections_v2_test', { input: { connection: sample, secrets: [] } });
    expect(r).toEqual(ok);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
npx vitest run src/components/features/connections/__tests__/useConnectionsV2.test.ts
```
Expected: FAIL with "cannot resolve `../useConnectionsV2`".

- [ ] **Step 3: Implement the store.**

```ts
// src/components/features/connections/useConnectionsV2.ts
import { create } from 'zustand';
import {
  listV2,
  saveV2,
  deleteV2,
  testV2,
  type SaveInput,
  type TestResult,
} from '../../../connection/ipc';
import type { Connection } from '../../../connection/model';

export interface ConnectionsV2Store {
  connections: Connection[];
  loading: boolean;
  refresh: () => Promise<void>;
  save: (input: SaveInput) => Promise<Connection>;
  remove: (id: string) => Promise<void>;
  test: (input: SaveInput) => Promise<TestResult>;
}

export const useConnectionsV2 = create<ConnectionsV2Store>((set, get) => ({
  connections: [],
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const connections = await listV2();
      set({ connections });
    } finally {
      set({ loading: false });
    }
  },
  save: async (input) => {
    const saved = await saveV2(input);
    await get().refresh();
    return saved;
  },
  remove: async (id) => {
    await deleteV2(id);
    await get().refresh();
  },
  test: (input) => testV2(input),
}));
```

- [ ] **Step 4: Run tests; expect PASS.**

```bash
npx vitest run src/components/features/connections/__tests__/useConnectionsV2.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit.**

```bash
git add src/components/features/connections/useConnectionsV2.ts src/components/features/connections/__tests__/useConnectionsV2.test.ts
git commit -m "feat(connections): useConnectionsV2 zustand store over v2 IPC"
```

---

## Task 2: TabSpec interface + tab registry + ServerTab (the simplest tab)

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/types.ts`
- Create: `src/components/features/connections/dialog-v2/tabs/registry.ts`
- Create: `src/components/features/connections/dialog-v2/tabs/ServerTab.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/__tests__/ServerTab.test.tsx`

- [ ] **Step 1: Define types in `tabs/types.ts`.**

```ts
import type { ComponentType } from 'react';
import type { Connection } from '../../../../../connection/model';
import type { GlobalPrefs } from '../../../../../connection/overrides';
import type { ValidationIssue } from '../../../../../connection/validation';
import type { SecretSlot } from '../../../../../connection/ipc';

export type TabId =
  | 'server' | 'auth' | 'tls' | 'ssh' | 'proxy'
  | 'intelliShell' | 'tools' | 'advanced';

export type TabGroup = 'transport' | 'prefs';

export interface TabFormProps {
  value: Connection;
  onChange: (next: Connection) => void;
  globals: GlobalPrefs;
  secrets: Partial<Record<SecretSlot, string>>;
  onSecretChange: (slot: SecretSlot, value: string) => void;
}

export interface TabSpec {
  id: TabId;
  label: string;
  group: TabGroup;
  Form: ComponentType<TabFormProps>;
  validate: (value: Connection) => ValidationIssue[];
  hasOverrides?: (value: Connection) => boolean;
}
```

- [ ] **Step 2: Write the failing test for ServerTab.**

```tsx
// src/components/features/connections/dialog-v2/tabs/__tests__/ServerTab.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServerTab } from '../ServerTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

const direct: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'db.example', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ServerTab', () => {
  it('renders host and port for kind=direct', () => {
    render(<ServerTab value={direct} onChange={() => {}} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    expect(screen.getByLabelText(/host/i)).toHaveValue('db.example');
    expect(screen.getByLabelText(/port/i)).toHaveValue(27017);
  });

  it('updates host via onChange', () => {
    const onChange = vi.fn();
    render(<ServerTab value={direct} onChange={onChange} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'other.host' } });
    expect(onChange).toHaveBeenCalledWith({
      ...direct,
      target: { kind: 'direct', host: 'other.host', port: 27017 },
    });
  });

  it('switching target kind to URI prompts before wiping fields', () => {
    const onChange = vi.fn();
    window.confirm = vi.fn(() => true);
    render(<ServerTab value={direct} onChange={onChange} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/connection uri/i));
    expect(window.confirm).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ ...direct, target: { kind: 'uri', uri: '' } });
  });

  it('renders URI input for kind=uri', () => {
    const uri: Connection = { ...direct, target: { kind: 'uri', uri: 'mongodb://x' } };
    render(<ServerTab value={uri} onChange={() => {}} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    expect(screen.getByLabelText(/connection uri/i)).toBeChecked();
    expect(screen.getByDisplayValue('mongodb://x')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Confirm `DEFAULT_GLOBAL_PREFS` exists in `src/connection/overrides.ts`.**

Search: `grep -n "DEFAULT_GLOBAL_PREFS\|GlobalPrefs" src/connection/overrides.ts`. If the constant is not exported, add it now in `src/connection/overrides.ts`:

```ts
export const DEFAULT_GLOBAL_PREFS: GlobalPrefs = {
  intelliShell: { commandTimeoutMs: 30000, autoCompleteEnabled: true, printLimit: 1000 },
  tools: {
    mongodumpPath: '/usr/bin/mongodump',
    mongorestorePath: '/usr/bin/mongorestore',
    mongoexportPath: '/usr/bin/mongoexport',
    mongoimportPath: '/usr/bin/mongoimport',
  },
  advanced: {
    appName: 'mongo-lens', retryWrites: true, retryReads: true,
    compressors: ['snappy'],
    serverSelectionTimeoutMs: 30000, connectTimeoutMs: 10000, socketTimeoutMs: 0,
  },
};
```

- [ ] **Step 4: Implement ServerTab.**

```tsx
// src/components/features/connections/dialog-v2/tabs/ServerTab.tsx
import type { TabFormProps } from './types';
import type { Connection, ConnectionTarget } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';

export function ServerTab({ value, onChange }: TabFormProps) {
  const target = value.target;

  function setTarget(t: ConnectionTarget) {
    onChange({ ...value, target: t });
  }

  function switchKind(nextKind: 'direct' | 'uri') {
    if (nextKind === target.kind) return;
    // Warn if there's existing data we'd discard
    const hasData =
      (target.kind === 'direct' && (target.host || target.port !== 27017)) ||
      (target.kind === 'uri' && target.uri);
    if (hasData && !window.confirm('Switching will discard the current Server tab values. Continue?')) {
      return;
    }
    setTarget(
      nextKind === 'direct'
        ? { kind: 'direct', host: '', port: 27017 }
        : { kind: 'uri', uri: '' },
    );
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Target type" style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <label>
          <input type="radio" name="target-kind" checked={target.kind === 'direct'} onChange={() => switchKind('direct')} />
          Direct (host / port)
        </label>
        <label>
          <input type="radio" name="target-kind" checked={target.kind === 'uri'} onChange={() => switchKind('uri')} />
          Connection URI
        </label>
      </div>

      {target.kind === 'direct' && (
        <div style={{ display: 'flex', gap: 12 }}>
          <FormField>
            <FormField.Label htmlFor="srv-host">Host</FormField.Label>
            <FormField.Input
              id="srv-host"
              value={target.host}
              onChange={(e) => setTarget({ ...target, host: e.target.value })}
            />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="srv-port">Port</FormField.Label>
            <FormField.Input
              id="srv-port"
              type="number"
              value={target.port}
              onChange={(e) => setTarget({ ...target, port: Number(e.target.value) })}
            />
          </FormField>
        </div>
      )}

      {target.kind === 'uri' && (
        <FormField>
          <FormField.Label htmlFor="srv-uri">Connection URI</FormField.Label>
          <FormField.Input
            id="srv-uri"
            value={target.uri}
            onChange={(e) => setTarget({ ...target, uri: e.target.value })}
            placeholder="mongodb+srv://…"
          />
        </FormField>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create the registry with ServerTab.**

```ts
// src/components/features/connections/dialog-v2/tabs/registry.ts
import { ServerTab } from './ServerTab';
import { validateTarget } from '../../../../../connection/validation';
import type { TabSpec } from './types';

/**
 * Connection-dialog tab registry.
 *
 * To add a new tab: implement TabSpec in a new file under ./tabs, then add
 * one entry below. No other file edits required.
 */
export const TABS: TabSpec[] = [
  {
    id: 'server',
    label: 'Server',
    group: 'transport',
    Form: ServerTab,
    validate: (c) => validateTarget(c.target),
  },
];
```

- [ ] **Step 6: Run tests.**

```bash
npx vitest run src/components/features/connections/dialog-v2/tabs/__tests__/ServerTab.test.tsx
```
Expected: 4 passed.

- [ ] **Step 7: Commit.**

```bash
git add src/components/features/connections/dialog-v2/tabs/ src/connection/overrides.ts
git commit -m "feat(dialog-v2): TabSpec registry + ServerTab"
```

---

## Task 3: useDialogState reducer

**Files:**
- Create: `src/components/features/connections/dialog-v2/useDialogState.ts`
- Create: `src/components/features/connections/dialog-v2/__tests__/useDialogState.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { dialogReducer, initialDialogState } from '../useDialogState';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../connection/overrides';
import type { Connection } from '../../../../../connection/model';

const sample: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'scram', username: 'u', authDb: 'admin', mechanism: 'auto' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('dialogReducer', () => {
  const init = initialDialogState(sample, DEFAULT_GLOBAL_PREFS);

  it('set-field updates a top-level field', () => {
    const next = dialogReducer(init, { type: 'set-field', path: 'name', value: 'Renamed' });
    expect(next.draft.name).toBe('Renamed');
  });

  it('set-field updates a nested field via dot-path', () => {
    const next = dialogReducer(init, { type: 'set-field', path: 'target.host', value: 'other' });
    expect(next.draft.target).toEqual({ kind: 'direct', host: 'other', port: 27017 });
  });

  it('set-auth-kind switches auth variant and zeros fields', () => {
    const next = dialogReducer(init, { type: 'set-auth-kind', kind: 'x509' });
    expect(next.draft.auth).toEqual({ kind: 'x509', certFile: '' });
  });

  it('set-secret stores a secret slot', () => {
    const next = dialogReducer(init, { type: 'set-secret', slot: 'auth-password', value: 'pw' });
    expect(next.secrets['auth-password']).toBe('pw');
  });

  it('test-start sets pending', () => {
    expect(dialogReducer(init, { type: 'test-start' }).testResult).toEqual({ kind: 'pending' });
  });

  it('test-result OK stores serverInfo', () => {
    const next = dialogReducer(init, { type: 'test-result', result: { ok: true, serverInfo: { v: 1 } } });
    expect(next.testResult).toEqual({ kind: 'ok', serverInfo: { v: 1 } });
  });

  it('test-result fail stores stage + error', () => {
    const next = dialogReducer(init, {
      type: 'test-result',
      result: { ok: false, stage: 'auth', error: 'bad creds' },
    });
    expect(next.testResult).toEqual({ kind: 'fail', stage: 'auth', error: 'bad creds' });
  });
});
```

- [ ] **Step 2: Implement the reducer.**

```ts
// src/components/features/connections/dialog-v2/useDialogState.ts
import type { Connection, AuthMode } from '../../../../connection/model';
import type { GlobalPrefs } from '../../../../connection/overrides';
import type { SecretSlot, TestResult } from '../../../../connection/ipc';
import type { BuildStage } from '../../../../connection/ipc';

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
```

- [ ] **Step 3: Run tests.**

```bash
npx vitest run src/components/features/connections/dialog-v2/__tests__/useDialogState.test.ts
```
Expected: 7 passed.

- [ ] **Step 4: Commit.**

```bash
git add src/components/features/connections/dialog-v2/useDialogState.ts src/components/features/connections/dialog-v2/__tests__/useDialogState.test.ts
git commit -m "feat(dialog-v2): useDialogState reducer"
```

---

## Task 4: ConnectionDialogV2 shell + ColorPicker + sidebar layout

**Files:**
- Create: `src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx`
- Create: `src/components/features/connections/dialog-v2/ConnectionDialogV2.module.css`
- Create: `src/components/features/connections/dialog-v2/tabs/shared/ColorPicker.tsx`
- Create: `src/components/features/connections/dialog-v2/__tests__/ConnectionDialogV2.test.tsx`

- [ ] **Step 1: Write the failing test for the shell.**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionDialogV2 } from '../ConnectionDialogV2';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../connection/overrides';
import type { Connection } from '../../../../../connection/model';

const sample: Connection = {
  id: 'a', name: 'My Cluster', color: '#10b981',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ConnectionDialogV2', () => {
  it('renders name + color picker + Server tab content for existing connection', () => {
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/connection name/i)).toHaveValue('My Cluster');
    expect(screen.getByRole('tab', { name: /server/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/host/i)).toHaveValue('h');
  });

  it('Cancel without dirty changes invokes onCancel immediately', () => {
    const onCancel = vi.fn();
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Save invokes onSave with {connection, secrets}', () => {
    const onSave = vi.fn().mockResolvedValue(sample);
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith({ connection: sample, secrets: [] });
  });

  it('Save is disabled when host is empty (validation error)', () => {
    const blank: Connection = { ...sample, target: { kind: 'direct', host: '', port: 27017 } };
    render(<ConnectionDialogV2 initial={blank} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/issues/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `ColorPicker`.**

```tsx
// src/components/features/connections/dialog-v2/tabs/shared/ColorPicker.tsx
const SWATCHES = [
  { color: undefined, label: 'No tag' },
  { color: '#ef4444', label: 'prod' },
  { color: '#f59e0b', label: 'staging' },
  { color: '#10b981', label: 'dev' },
  { color: '#3b82f6', label: 'local' },
] as const;

export function ColorPicker({ value, onChange }: { value: string | undefined; onChange: (c: string | undefined) => void }) {
  return (
    <select
      aria-label="Environment color"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      {SWATCHES.map((s) => (
        <option key={s.label} value={s.color ?? ''}>● {s.label}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Implement the shell.**

```tsx
// src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx
import { useMemo, useReducer } from 'react';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { FormField } from '../../../ui/FormField';
import { ColorPicker } from './tabs/shared/ColorPicker';
import { TABS } from './tabs/registry';
import { dialogReducer, initialDialogState } from './useDialogState';
import { validateConnection } from '../../../../connection/validation';
import type { Connection } from '../../../../connection/model';
import type { GlobalPrefs } from '../../../../connection/overrides';
import type { SaveInput, SecretInput } from '../../../../connection/ipc';
import styles from './ConnectionDialogV2.module.css';

interface Props {
  initial: Connection | null;
  globals: GlobalPrefs;
  onSave: (input: SaveInput) => Promise<Connection>;
  onCancel: () => void;
}

export function ConnectionDialogV2({ initial, globals, onSave, onCancel }: Props) {
  const [state, dispatch] = useReducer(dialogReducer, undefined, () => initialDialogState(initial, globals));
  const [activeTabId, setActiveTabId] = (require('react') as typeof import('react')).useState<string>('server');
  const issues = useMemo(() => validateConnection(state.draft), [state.draft]);
  const issuesByTab = useMemo(() => new Map(TABS.map((t) => [t.id, t.validate(state.draft)])), [state.draft]);
  const activeTab = TABS.find((t) => t.id === activeTabId)!;
  const transportTabs = TABS.filter((t) => t.group === 'transport');
  const prefsTabs = TABS.filter((t) => t.group === 'prefs');

  function handleSave() {
    const secrets: SecretInput[] = Object.entries(state.secrets)
      .filter(([_, v]) => v !== undefined)
      .map(([slot, value]) => ({ slot: slot as any, value: value as string }));
    onSave({ connection: state.draft, secrets });
  }

  return (
    <Dialog open onClose={onCancel} ariaLabel="Connection editor" width={720}>
      <div className={styles.header}>
        <FormField>
          <FormField.Label htmlFor="conn-name">Connection name</FormField.Label>
          <FormField.Input
            id="conn-name"
            value={state.draft.name}
            onChange={(e) => dispatch({ type: 'set-field', path: 'name', value: e.target.value })}
          />
        </FormField>
        <ColorPicker
          value={state.draft.color}
          onChange={(c) => dispatch({ type: 'set-field', path: 'color', value: c })}
        />
      </div>

      <div className={styles.body}>
        <nav className={styles.sidebar} role="tablist" aria-label="Connection settings tabs">
          {transportTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTabId === t.id}
              className={activeTabId === t.id ? styles.tabActive : styles.tab}
              onClick={() => setActiveTabId(t.id)}
            >
              {t.label}
              {(issuesByTab.get(t.id) ?? []).length > 0 && <span className={styles.errBadge}> ●</span>}
            </button>
          ))}
          {prefsTabs.length > 0 && <hr className={styles.divider} />}
          {prefsTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTabId === t.id}
              className={activeTabId === t.id ? styles.tabActive : styles.tab}
              onClick={() => setActiveTabId(t.id)}
            >
              {t.label}
              {t.hasOverrides?.(state.draft) && <span className={styles.overrideBadge}> ●</span>}
            </button>
          ))}
        </nav>
        <div role="tabpanel" className={styles.panel}>
          <activeTab.Form
            value={state.draft}
            onChange={(next) => dispatch({ type: 'set-field', path: '', value: next })}
            globals={state.globals}
            secrets={state.secrets}
            onSecretChange={(slot, value) => dispatch({ type: 'set-secret', slot, value })}
          />
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.issues}>
          {issues.length > 0 && <span>⚠ {issues.length} issues across tabs</span>}
        </div>
        <div className={styles.actions}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={issues.length > 0} onClick={handleSave}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
```

(Fix the `set-field` `path === ''` whole-replace: add to `dialogReducer`:)

```ts
// in dialogReducer, update set-field case:
case 'set-field':
  if (action.path === '') {
    return { ...state, draft: action.value as Connection };
  }
  return { ...state, draft: setByPath(state.draft, action.path, action.value) };
```

- [ ] **Step 4: Implement minimal CSS module.**

```css
/* src/components/features/connections/dialog-v2/ConnectionDialogV2.module.css */
.header { display: flex; gap: 12px; align-items: end; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.body { display: flex; min-height: 360px; }
.sidebar { width: 140px; border-right: 1px solid var(--border); background: var(--surface-2); display: flex; flex-direction: column; }
.tab, .tabActive { padding: 8px 12px; text-align: left; background: transparent; border: none; border-left: 3px solid transparent; cursor: pointer; }
.tabActive { background: var(--surface-1); border-left-color: var(--accent); font-weight: 600; }
.errBadge { color: #ef4444; }
.overrideBadge { color: #f59e0b; }
.divider { border: none; border-top: 1px dashed var(--border); margin: 6px 8px; }
.panel { flex: 1; padding: 16px; }
.footer { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; border-top: 1px solid var(--border); }
.issues { color: #ef4444; font-size: 12px; }
.actions { display: flex; gap: 8px; }
```

- [ ] **Step 5: Run tests.**

```bash
npx vitest run src/components/features/connections/dialog-v2/__tests__/ConnectionDialogV2.test.tsx
```
Expected: 4 passed.

- [ ] **Step 6: Commit.**

```bash
git add src/components/features/connections/dialog-v2/
git commit -m "feat(dialog-v2): shell + ColorPicker + sidebar layout"
```

---

## Task 5: ConnectionTree color stripe + wire useConnectionsV2

**Files:**
- Modify: `src/components/features/connections/ConnectionTree.tsx`
- Modify: `src/components/features/connections/ConnectionTree.module.css`
- Modify: `src/components/features/connections/__tests__/connection-tree.test.tsx`

- [ ] **Step 1: Read the existing `ConnectionTree.tsx`** to learn the row layout and find where to inject the stripe + dot. Don't edit yet.

- [ ] **Step 2: Add a failing test asserting color stripe.**

In `src/components/features/connections/__tests__/connection-tree.test.tsx`, add:

```tsx
it('renders the env color stripe when connection.color is set', () => {
  // Use the existing test setup; mock useConnectionsV2 to return [{ ...sample, color: '#ef4444' }].
  // Assert the row has an element with the color set as the left border.
  // …per existing fixture style…
});
```

(The exact mock shape must match how the existing test wires `useConnectionsStore` — switch the mock to `useConnectionsV2`. The existing test should keep passing for non-color rows.)

- [ ] **Step 3: Modify `ConnectionTree.tsx`** — add a 3px left border styled from `connection.color || 'transparent'` on each row. The connection list source switches from `useConnectionsStore` to `useConnectionsV2` (call `refresh()` on mount via `useEffect`).

- [ ] **Step 4: Run tests.**

```bash
npx vitest run src/components/features/connections/__tests__/connection-tree.test.tsx
```
Expected: all pass; the new color-stripe assertion passes; previously passing tests still pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/features/connections/ConnectionTree.tsx src/components/features/connections/ConnectionTree.module.css src/components/features/connections/__tests__/connection-tree.test.tsx
git commit -m "feat(connections): ConnectionTree color stripe + useConnectionsV2 read path"
```

---

## Task 6: DIALOG_V2 escape hatch wiring in ConnectionPanel

**Files:**
- Modify: `src/components/features/connections/ConnectionPanel.tsx`
- Create: `src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx`

- [ ] **Step 1: Add the escape hatch.** In `ConnectionPanel.tsx`, branch the dialog choice on `import.meta.env.VITE_DIALOG_V2 === '1' || new URLSearchParams(window.location.search).get('dialog') === 'v2'`. When the hatch is on, render `<ConnectionDialogV2 initial={…} globals={…} onSave={…} onCancel={…} />`; otherwise render the existing `<ConnectionDialog …>` unchanged.

- [ ] **Step 2: Load globals once at panel mount.** Add a `useEffect` that calls `prefsGet()` from `src/connection/ipc.ts` (add the wrapper there if missing — `invoke('prefs_get')`) and stores into local state. Pass to dialog as `globals` prop.

- [ ] **Step 3: Wire `onSave`** to `useConnectionsV2.save({ connection, secrets })` → close dialog.

- [ ] **Step 4: Write a test that toggles the escape hatch on and asserts the new dialog renders.**

```tsx
it('renders ConnectionDialogV2 when DIALOG_V2 escape hatch is on', () => {
  Object.defineProperty(window, 'location', { value: { ...window.location, search: '?dialog=v2' }, writable: true });
  // mock useConnectionsV2 + prefsGet, click "Add connection" — expect ConnectionDialogV2 marker (e.g. aria-label="Connection editor").
});
```

- [ ] **Step 5: Run all connection-panel tests.**

```bash
npx vitest run src/components/features/connections/__tests__/connection-panel
```
Expected: previously passing tests still pass; new test passes.

- [ ] **Step 6: Commit.**

```bash
git add src/components/features/connections/ConnectionPanel.tsx src/components/features/connections/__tests__/
git commit -m "feat(connections): DIALOG_V2 escape hatch in ConnectionPanel"
```

---

**End of PR 1.** At this point the new dialog opens behind `?dialog=v2`, ServerTab works end-to-end, save persists to `connections_v2`, tree shows color stripe. Old dialog still default.

```bash
npm test  # full suite — all green
```

Open a PR with all 6 commits.

---

# PR 2 — Transport tabs: Auth + TLS + SSH + Proxy

## Task 7: AuthTab + 8 sub-forms via sub-registry

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/AuthTab.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/auth/registry.ts`
- Create: `src/components/features/connections/dialog-v2/tabs/auth/{None,Scram,LegacyCr,X509,Ldap,Kerberos,AwsIam,Oidc}Form.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/__tests__/AuthTab.test.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/registry.ts` (add AuthTab entry)

- [ ] **Step 1: Define the sub-form contract.**

```ts
// src/components/features/connections/dialog-v2/tabs/auth/registry.ts
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
  // value.auth is the active variant
}

/** To add a new AuthMode variant:
 * 1. Add the variant to `AuthMode` in src/connection/model.ts and its Rust mirror.
 * 2. Add a sub-form here and register below.
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
```

- [ ] **Step 2: Implement ScramForm (canonical sub-form pattern).**

```tsx
// src/components/features/connections/dialog-v2/tabs/auth/ScramForm.tsx
import { FormField } from '../../../../../ui/FormField';
import type { AuthSubFormProps } from './registry';

export function ScramForm({ value, onChange, secrets, onSecretChange }: AuthSubFormProps) {
  if (value.auth.kind !== 'scram') return null;
  const a = value.auth;
  const editingExisting = !!value.id;
  return (
    <>
      <FormField>
        <FormField.Label htmlFor="scram-user">Username</FormField.Label>
        <FormField.Input
          id="scram-user"
          value={a.username}
          onChange={(e) => onChange({ ...value, auth: { ...a, username: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="scram-pw">Password</FormField.Label>
        <FormField.Input
          id="scram-pw"
          type="password"
          value={secrets['auth-password'] ?? ''}
          placeholder={editingExisting && secrets['auth-password'] === undefined ? '(stored in Keychain — leave blank to keep)' : ''}
          onChange={(e) => onSecretChange('auth-password', e.target.value)}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="scram-authdb">Auth DB</FormField.Label>
        <FormField.Input
          id="scram-authdb"
          value={a.authDb}
          onChange={(e) => onChange({ ...value, auth: { ...a, authDb: e.target.value } })}
        />
      </FormField>
      <FormField>
        <FormField.Label htmlFor="scram-mech">Mechanism</FormField.Label>
        <select
          id="scram-mech"
          value={a.mechanism ?? 'auto'}
          onChange={(e) => onChange({ ...value, auth: { ...a, mechanism: e.target.value as any } })}
        >
          <option value="auto">Auto-negotiate</option>
          <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
          <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
        </select>
      </FormField>
    </>
  );
}
```

- [ ] **Step 3: Implement remaining 7 sub-forms following the ScramForm pattern.**

Each is a small component reading `value.auth` (after a kind-narrow guard) and dispatching `onChange({ ...value, auth: { ...narrowed, <field>: <new> } })`. Secrets fields use `onSecretChange` with their slot:

- **NoneForm:** returns `<p>No authentication will be attempted.</p>`.
- **LegacyCrForm:** username + password + authDb. Password slot: `'auth-password'`. Add a warning: "Legacy MONGODB-CR is deprecated; use SCRAM for new deployments."
- **X509Form:** `certFile` (FilePicker, see Task 8) + optional `certKeyFile`.
- **LdapForm:** username + password (slot `'auth-password'`) + info text: "LDAP requires MongoDB Enterprise."
- **KerberosForm:** `principal`, optional `serviceName`, `canonicalizeHostName` checkbox + info text: "Kerberos requires MongoDB Enterprise and the gssapi-auth cargo feature."
- **AwsIamForm:** `accessKeyId`, secret (slot `'aws-secret-key'`), `sessionToken`, `useEnvCreds` checkbox.
- **OidcForm:** `principal`, `providerName` + info text: "OIDC requires MongoDB Enterprise."

(Reference implementation pattern: copy ScramForm, narrow on `kind`, swap fields. Each sub-form is 20–40 lines.)

- [ ] **Step 4: Implement AuthTab dispatching to sub-forms.**

```tsx
// src/components/features/connections/dialog-v2/tabs/AuthTab.tsx
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
          // Use the parent reducer through onChange — switching kind needs the blank-auth helper.
          // Easiest: pass through a special set-auth-kind path via props.onChange — see Step 5.
          props.onChange({ ...props.value, auth: blankAuth(kind) });
        }}
      >
        {Object.entries(AUTH_LABELS).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      <SubForm {...props} />
    </>
  );
}

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
```

(`blankAuth` is duplicated here and in `useDialogState.ts`. Acceptable for clarity in PR 2; can be hoisted to shared utility in PR 3 if it gets a third caller.)

- [ ] **Step 5: Register AuthTab in `tabs/registry.ts`.**

```ts
import { AuthTab } from './AuthTab';
import { validateAuth } from '../../../../../connection/validation';
// add to TABS array:
{ id: 'auth', label: 'Auth', group: 'transport', Form: AuthTab, validate: (c) => validateAuth(c.auth) },
```

- [ ] **Step 6: Write AuthTab.test.tsx.**

```tsx
describe('AuthTab', () => {
  it('renders ScramForm when auth.kind=scram', () => { /* … */ });
  it('renders NoneForm when auth.kind=none', () => { /* … */ });
  it('switching mode replaces auth with blank variant', () => {
    const onChange = vi.fn();
    render(<AuthTab value={{ ...sample, auth: { kind: 'scram', username: 'u', authDb: 'admin' } }} onChange={onChange} … />);
    fireEvent.change(screen.getByLabelText(/authentication mode/i), { target: { value: 'x509' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: 'x509', certFile: '' } }));
  });
  it('password placeholder reads "(stored in Keychain…)" on edit', () => { /* … */ });
});
```

- [ ] **Step 7: Run tests, commit.**

```bash
npx vitest run src/components/features/connections/dialog-v2/tabs/
git add src/components/features/connections/dialog-v2/tabs/AuthTab.tsx src/components/features/connections/dialog-v2/tabs/auth/ src/components/features/connections/dialog-v2/tabs/registry.ts src/components/features/connections/dialog-v2/tabs/__tests__/AuthTab.test.tsx
git commit -m "feat(dialog-v2): AuthTab + 8 sub-forms via sub-registry"
```

---

## Task 8: FilePicker shared component

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/shared/FilePicker.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/shared/__tests__/FilePicker.test.tsx`

- [ ] **Step 1: Implement FilePicker.**

```tsx
import { open } from '@tauri-apps/plugin-dialog';
import { FormField } from '../../../../../ui/FormField';
import { Button } from '../../../../../ui/Button';

export function FilePicker({
  id, label, value, onChange, filters,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (path: string | undefined) => void;
  filters?: { name: string; extensions: string[] }[];
}) {
  async function browse() {
    const selected = await open({ multiple: false, directory: false, filters });
    if (typeof selected === 'string') onChange(selected);
  }
  return (
    <FormField>
      <FormField.Label htmlFor={id}>{label}</FormField.Label>
      <div style={{ display: 'flex', gap: 6 }}>
        <FormField.Input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
        <Button onClick={browse}>Browse…</Button>
      </div>
    </FormField>
  );
}
```

- [ ] **Step 2: Write test mocking @tauri-apps/plugin-dialog.**

```tsx
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue('/etc/ssl/ca.pem') }));

it('Browse populates value from open() result', async () => {
  const onChange = vi.fn();
  render(<FilePicker id="x" label="CA file" value={undefined} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /browse/i }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('/etc/ssl/ca.pem'));
});
```

- [ ] **Step 3: Run tests, commit.**

```bash
git add src/components/features/connections/dialog-v2/tabs/shared/FilePicker.tsx src/components/features/connections/dialog-v2/tabs/shared/__tests__/FilePicker.test.tsx
git commit -m "feat(dialog-v2): FilePicker shared component"
```

---

## Task 9: TlsTab

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/TlsTab.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/__tests__/TlsTab.test.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/registry.ts`

- [ ] **Step 1: Implement TlsTab.**

```tsx
import type { TabFormProps } from './types';
import { FormField } from '../../../../ui/FormField';
import { FilePicker } from './shared/FilePicker';

export function TlsTab({ value, onChange }: TabFormProps) {
  const tls = value.tls;
  const enabled = !!tls?.enabled;

  function set(next: typeof tls) {
    onChange({ ...value, tls: next });
  }

  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => set(e.target.checked ? { enabled: true } : { enabled: false })}
        />
        Enable TLS
      </label>

      {enabled && tls?.enabled && (
        <>
          <FilePicker
            id="tls-ca"
            label="CA certificate (PEM)"
            value={tls.caFile}
            onChange={(p) => set({ ...tls, caFile: p })}
            filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
          />
          <FilePicker
            id="tls-clientcert"
            label="Client certificate (PEM)"
            value={tls.clientCertFile}
            onChange={(p) => set({ ...tls, clientCertFile: p })}
            filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
          />
          <label>
            <input
              type="checkbox"
              checked={!!tls.allowInvalidCerts}
              onChange={(e) => set({ ...tls, allowInvalidCerts: e.target.checked })}
            />
            Allow invalid certificates (insecure)
          </label>
          {tls.allowInvalidCerts && (
            <div role="alert" style={{ color: '#ef4444', marginTop: 8 }}>
              ⚠ Server certificate validation is disabled. Use only for trusted internal hosts.
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={!!tls.allowInvalidHostnames}
              onChange={(e) => set({ ...tls, allowInvalidHostnames: e.target.checked })}
            />
            Allow invalid hostnames
          </label>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Write tests covering toggle reveal, warning banner, file picker integration.**

```tsx
it('reveals fields when TLS toggled on', () => { /* … */ });
it('shows warning banner when allowInvalidCerts is on', () => { /* … */ });
```

- [ ] **Step 3: Register in `tabs/registry.ts`.**

```ts
{ id: 'tls', label: 'TLS', group: 'transport', Form: TlsTab, validate: (c) => validateTls(c.tls) },
```

- [ ] **Step 4: Run tests, commit.**

```bash
git add src/components/features/connections/dialog-v2/tabs/TlsTab.tsx src/components/features/connections/dialog-v2/tabs/__tests__/TlsTab.test.tsx src/components/features/connections/dialog-v2/tabs/registry.ts
git commit -m "feat(dialog-v2): TlsTab"
```

---

## Task 10: SshTab + 3 sub-forms

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/SshTab.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/ssh/registry.ts`
- Create: `src/components/features/connections/dialog-v2/tabs/ssh/{Password,Key,Agent}Form.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/__tests__/SshTab.test.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/registry.ts`

- [ ] **Step 1: Pattern matches AuthTab.** SshTab has a top-level toggle (enable tunnel); when on, shows host/port/user + auth-method radio (password / key / agent); auth sub-form dispatches via `SSH_AUTH_FORMS` registry.

- [ ] **Step 2: Implement Key sub-form** (most complex of three):

```tsx
import { FormField } from '../../../../../ui/FormField';
import { FilePicker } from '../shared/FilePicker';
import type { AuthSubFormProps } from '../auth/registry';   // reuse same shape

export function KeyForm({ value, onChange, secrets, onSecretChange }: AuthSubFormProps) {
  if (!value.ssh || value.ssh.auth.kind !== 'key') return null;
  const ssh = value.ssh;
  const a = ssh.auth;
  return (
    <>
      <FilePicker
        id="ssh-keypath"
        label="Private key file"
        value={a.keyPath}
        onChange={(p) => onChange({ ...value, ssh: { ...ssh, auth: { ...a, keyPath: p ?? '' } } })}
      />
      <label>
        <input
          type="checkbox"
          checked={a.hasPassphrase}
          onChange={(e) => onChange({ ...value, ssh: { ...ssh, auth: { ...a, hasPassphrase: e.target.checked } } })}
        />
        Key requires passphrase
      </label>
      {a.hasPassphrase && (
        <FormField>
          <FormField.Label htmlFor="ssh-pass">Passphrase</FormField.Label>
          <FormField.Input
            id="ssh-pass"
            type="password"
            value={secrets['ssh-key-passphrase'] ?? ''}
            placeholder={value.id && !secrets['ssh-key-passphrase'] ? '(stored in Keychain — leave blank to keep)' : ''}
            onChange={(e) => onSecretChange('ssh-key-passphrase', e.target.value)}
          />
        </FormField>
      )}
    </>
  );
}
```

- [ ] **Step 3: Implement PasswordForm** (username password slot `ssh-password`) **and AgentForm** (just an info note: "Uses identities from SSH_AUTH_SOCK").

- [ ] **Step 4: Implement SshTab dispatching enable toggle + host/port/user + auth-method radio + sub-form + known-hosts policy dropdown.** Pattern: when toggle is on, `value.ssh` is `{ host, port: 22, user: '', auth: { kind: 'password' }, knownHostsPolicy: 'strict' }`; when off, `value.ssh = undefined`.

- [ ] **Step 5: Register, test, commit.**

```bash
git add src/components/features/connections/dialog-v2/tabs/SshTab.tsx src/components/features/connections/dialog-v2/tabs/ssh/ src/components/features/connections/dialog-v2/tabs/__tests__/SshTab.test.tsx src/components/features/connections/dialog-v2/tabs/registry.ts
git commit -m "feat(dialog-v2): SshTab + 3 sub-forms"
```

---

## Task 11: ProxyTab

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/ProxyTab.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/__tests__/ProxyTab.test.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/registry.ts`

- [ ] **Step 1: Implement ProxyTab.** Enable toggle; when on, type radio (`http` / `socks4` / `socks5`), host, port, optional username. HTTP/SOCKS4 selected — show a `role="alert"` warning: "Only SOCKS5 is supported by the MongoDB driver. HTTP/SOCKS4 will fail at connect time."

```tsx
import type { TabFormProps } from './types';
import type { Proxy } from '../../../../connection/model';
import { FormField } from '../../../../ui/FormField';

export function ProxyTab({ value, onChange, secrets, onSecretChange }: TabFormProps) {
  const p = value.proxy;
  function setP(next: Proxy | undefined) { onChange({ ...value, proxy: next }); }
  return (
    <>
      <label>
        <input type="checkbox" checked={!!p} onChange={(e) =>
          setP(e.target.checked ? { kind: 'socks5', host: '', port: 1080 } : undefined)
        } />
        Enable proxy
      </label>
      {p && (
        <>
          <div role="radiogroup">
            {(['socks5', 'http', 'socks4'] as const).map((k) => (
              <label key={k}>
                <input type="radio" name="proxy-kind" checked={p.kind === k}
                  onChange={() => setP({ ...p, kind: k })} />
                {k.toUpperCase()}
              </label>
            ))}
          </div>
          {p.kind !== 'socks5' && (
            <div role="alert" style={{ color: '#ef4444' }}>
              Only SOCKS5 is supported by the MongoDB driver. {p.kind.toUpperCase()} will fail at connect time.
            </div>
          )}
          <FormField>
            <FormField.Label htmlFor="proxy-host">Host</FormField.Label>
            <FormField.Input id="proxy-host" value={p.host} onChange={(e) => setP({ ...p, host: e.target.value })} />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="proxy-port">Port</FormField.Label>
            <FormField.Input id="proxy-port" type="number" value={p.port}
              onChange={(e) => setP({ ...p, port: Number(e.target.value) })} />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="proxy-user">Username (optional)</FormField.Label>
            <FormField.Input id="proxy-user" value={p.auth?.username ?? ''}
              onChange={(e) => setP({ ...p, auth: e.target.value ? { username: e.target.value } : undefined })} />
          </FormField>
          {p.auth && (
            <FormField>
              <FormField.Label htmlFor="proxy-pw">Password</FormField.Label>
              <FormField.Input id="proxy-pw" type="password"
                value={secrets['proxy-password'] ?? ''}
                placeholder={value.id && !secrets['proxy-password'] ? '(stored in Keychain — leave blank to keep)' : ''}
                onChange={(e) => onSecretChange('proxy-password', e.target.value)} />
            </FormField>
          )}
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Tests** — toggle reveal, type radio swaps kind, HTTP/SOCKS4 warning appears, username field reveals password.

- [ ] **Step 3: Register, run, commit.**

```bash
git add src/components/features/connections/dialog-v2/tabs/ProxyTab.tsx src/components/features/connections/dialog-v2/tabs/__tests__/ProxyTab.test.tsx src/components/features/connections/dialog-v2/tabs/registry.ts
git commit -m "feat(dialog-v2): ProxyTab"
```

---

**End of PR 2.** All transport tabs functional behind the escape hatch. Test full suite + open PR.

---

# PR 3 — Prefs tabs: IntelliShell + Tools + Advanced + OverrideRow

## Task 12: OverrideRow shared component

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/shared/OverrideRow.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/shared/__tests__/OverrideRow.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OverrideRow } from '../OverrideRow';

describe('OverrideRow', () => {
  it('shows "Use global: <value>" placeholder when override is undefined', () => {
    render(<OverrideRow label="Command timeout (ms)" globalValue={30000} value={undefined} onChange={() => {}} />);
    expect(screen.getByText(/use global: 30000/i)).toBeInTheDocument();
  });

  it('renders the override value when set', () => {
    render(<OverrideRow label="Command timeout (ms)" globalValue={30000} value={5000} onChange={() => {}} />);
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument();
  });

  it('Reset button clears the override (sets undefined)', () => {
    const onChange = vi.fn();
    render(<OverrideRow label="Command timeout (ms)" globalValue={30000} value={5000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('false ≠ undefined for boolean fields', () => {
    const onChange = vi.fn();
    render(<OverrideRow label="Auto-complete" globalValue={true} value={false} onChange={onChange} type="boolean" />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.queryByText(/use global/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement OverrideRow.**

```tsx
// src/components/features/connections/dialog-v2/tabs/shared/OverrideRow.tsx
import { Button } from '../../../../../ui/Button';
import { FormField } from '../../../../../ui/FormField';

type Primitive = string | number | boolean;

interface Props<T extends Primitive> {
  label: string;
  globalValue: T;
  value: T | undefined;
  onChange: (next: T | undefined) => void;
  type?: 'text' | 'number' | 'boolean';
}

export function OverrideRow<T extends Primitive>({ label, globalValue, value, onChange, type = 'text' }: Props<T>) {
  const overridden = value !== undefined;
  if (type === 'boolean') {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
        <label style={{ flex: 1 }}>
          <input
            type="checkbox"
            checked={(overridden ? value : globalValue) as boolean}
            onChange={(e) => onChange(e.target.checked as T)}
          />
          {label}
        </label>
        {overridden && <Button onClick={() => onChange(undefined)}>Reset</Button>}
      </div>
    );
  }
  return (
    <FormField>
      <FormField.Label htmlFor={`ovr-${label}`}>{label}</FormField.Label>
      <div style={{ display: 'flex', gap: 6 }}>
        <FormField.Input
          id={`ovr-${label}`}
          type={type}
          value={(value ?? '') as any}
          placeholder={overridden ? '' : `Use global: ${String(globalValue)}`}
          onChange={(e) => {
            const v = type === 'number' ? Number(e.target.value) : e.target.value;
            onChange(v === '' || (type === 'number' && Number.isNaN(v)) ? undefined : (v as T));
          }}
        />
        {overridden && <Button onClick={() => onChange(undefined)}>Reset</Button>}
      </div>
    </FormField>
  );
}
```

- [ ] **Step 3: Run tests, commit.**

```bash
npx vitest run src/components/features/connections/dialog-v2/tabs/shared/__tests__/OverrideRow.test.tsx
git add src/components/features/connections/dialog-v2/tabs/shared/OverrideRow.tsx src/components/features/connections/dialog-v2/tabs/shared/__tests__/OverrideRow.test.tsx
git commit -m "feat(dialog-v2): OverrideRow with per-field global inheritance"
```

---

## Task 13: IntelliShellTab + ToolsTab + AdvancedTab

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/IntelliShellTab.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/ToolsTab.tsx`
- Create: `src/components/features/connections/dialog-v2/tabs/AdvancedTab.tsx`
- Create: tests for each
- Modify: `src/components/features/connections/dialog-v2/tabs/registry.ts`

- [ ] **Step 1: Implement IntelliShellTab (canonical prefs-tab pattern).**

```tsx
import type { TabFormProps } from './types';
import { OverrideRow } from './shared/OverrideRow';

export function IntelliShellTab({ value, onChange, globals }: TabFormProps) {
  const ovr = value.overrides?.intelliShell ?? {};
  function patch(field: keyof typeof ovr, v: unknown) {
    onChange({
      ...value,
      overrides: {
        ...value.overrides,
        intelliShell: { ...ovr, [field]: v },
      },
    });
  }
  return (
    <>
      <OverrideRow
        label="Command timeout (ms)"
        globalValue={globals.intelliShell.commandTimeoutMs}
        value={ovr.commandTimeoutMs}
        onChange={(v) => patch('commandTimeoutMs', v)}
        type="number"
      />
      <OverrideRow
        label="Auto-complete enabled"
        globalValue={globals.intelliShell.autoCompleteEnabled}
        value={ovr.autoCompleteEnabled}
        onChange={(v) => patch('autoCompleteEnabled', v)}
        type="boolean"
      />
      <OverrideRow
        label="Print limit"
        globalValue={globals.intelliShell.printLimit}
        value={ovr.printLimit}
        onChange={(v) => patch('printLimit', v)}
        type="number"
      />
    </>
  );
}

export function hasIntelliShellOverrides(c: { overrides?: { intelliShell?: object } }) {
  const o = c.overrides?.intelliShell;
  return !!o && Object.values(o).some((v) => v !== undefined);
}
```

- [ ] **Step 2: ToolsTab** — same pattern with 4 file-path fields (`mongodumpPath`, `mongorestorePath`, `mongoexportPath`, `mongoimportPath`). Use `FilePicker` instead of `OverrideRow`'s text input for these — wrap a small `OverridableFilePicker` if needed, or pattern-match by allowing OverrideRow to render a custom input (cleaner: just compose `FilePicker` + a "Reset to global" button directly here).

- [ ] **Step 3: AdvancedTab** — 7 fields: `appName` (text), `retryWrites` / `retryReads` (boolean), `compressors` (multi-select), `serverSelectionTimeoutMs` / `connectTimeoutMs` / `socketTimeoutMs` (number). Compressors gets a custom UI: a multi-select dropdown over `['snappy', 'zlib', 'zstd']` with a Reset button.

- [ ] **Step 4: Register all three tabs.**

```ts
import { IntelliShellTab, hasIntelliShellOverrides } from './IntelliShellTab';
import { ToolsTab, hasToolsOverrides } from './ToolsTab';
import { AdvancedTab, hasAdvancedOverrides } from './AdvancedTab';
// extend TABS:
{ id: 'intelliShell', label: 'IntelliShell', group: 'prefs', Form: IntelliShellTab, validate: () => [], hasOverrides: hasIntelliShellOverrides },
{ id: 'tools', label: 'Tools', group: 'prefs', Form: ToolsTab, validate: () => [], hasOverrides: hasToolsOverrides },
{ id: 'advanced', label: 'Advanced', group: 'prefs', Form: AdvancedTab, validate: () => [], hasOverrides: hasAdvancedOverrides },
```

- [ ] **Step 5: Tests** — each tab: override sets value, Reset clears, badge function returns true when overridden, false when all undefined.

- [ ] **Step 6: Run + commit.**

```bash
npx vitest run src/components/features/connections/dialog-v2/tabs/
git add src/components/features/connections/dialog-v2/tabs/IntelliShellTab.tsx src/components/features/connections/dialog-v2/tabs/ToolsTab.tsx src/components/features/connections/dialog-v2/tabs/AdvancedTab.tsx src/components/features/connections/dialog-v2/tabs/__tests__/{IntelliShellTab,ToolsTab,AdvancedTab}.test.tsx src/components/features/connections/dialog-v2/tabs/registry.ts
git commit -m "feat(dialog-v2): IntelliShellTab + ToolsTab + AdvancedTab"
```

---

## Task 14: Wire globals load via prefs_get into ConnectionPanel

**Files:**
- Modify: `src/components/features/connections/ConnectionPanel.tsx`
- Modify: `src/connection/ipc.ts` — add `prefsGet`, `prefsSet`.

- [ ] **Step 1: Add IPC wrappers** in `src/connection/ipc.ts`:

```ts
import type { GlobalPrefs } from './overrides';

export const prefsGet = () => invoke<GlobalPrefs>('prefs_get');
export const prefsSet = (prefs: GlobalPrefs) => invoke<void>('prefs_set', { prefs });
```

- [ ] **Step 2: In ConnectionPanel,** load globals once via `useEffect`; pass to `ConnectionDialogV2` as `globals` prop.

- [ ] **Step 3: Test** — mock `prefsGet`, render panel, open dialog, assert prefs tab shows the mocked global value.

- [ ] **Step 4: Commit.**

```bash
git add src/connection/ipc.ts src/components/features/connections/ConnectionPanel.tsx src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx
git commit -m "feat(connections): load globals via prefs_get for v2 dialog"
```

---

**End of PR 3.** All 8 tabs functional behind the escape hatch.

---

# PR 4 — Test Connection button + staged-error rendering

## Task 15: Test button + staged-error footer

**Files:**
- Modify: `src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx`
- Modify: `src/components/features/connections/dialog-v2/ConnectionDialogV2.module.css`
- Modify: `src/components/features/connections/dialog-v2/__tests__/ConnectionDialogV2.test.tsx`

- [ ] **Step 1: Add header Test button calling `useConnectionsV2.test`.**

```tsx
// inside ConnectionDialogV2:
const { test } = useConnectionsV2();
async function handleTest() {
  dispatch({ type: 'test-start' });
  const secrets: SecretInput[] = Object.entries(state.secrets)
    .filter(([_, v]) => v !== undefined)
    .map(([slot, value]) => ({ slot: slot as any, value: value as string }));
  const result = await test({ connection: state.draft, secrets });
  dispatch({ type: 'test-result', result });
}
```

Header now has a `<Button onClick={handleTest} disabled={issues.length > 0}>Test</Button>`.

- [ ] **Step 2: Add result rendering in the footer.**

```tsx
{state.testResult?.kind === 'pending' && <span>Testing…</span>}
{state.testResult?.kind === 'ok' && <span style={{ color: '#10b981' }}>✓ Connection OK</span>}
{state.testResult?.kind === 'fail' && (
  <div style={{ color: '#ef4444' }}>
    <strong>{stageHeading(state.testResult.stage)}</strong>: {state.testResult.error}
  </div>
)}
```

Where `stageHeading` is a small helper:

```ts
function stageHeading(s: 'ssh' | 'tls' | 'auth' | 'ping'): string {
  switch (s) {
    case 'ssh': return 'SSH tunnel failed';
    case 'tls': return 'TLS handshake failed';
    case 'auth': return 'Authentication failed';
    case 'ping': return 'Server ping failed';
  }
}
```

- [ ] **Step 3: Tests.**

```tsx
it('Test button calls connections_v2_test with current draft + secrets', () => { /* … */ });
it('renders "SSH tunnel failed" heading when stage=ssh', () => { /* … */ });
it('renders "✓ Connection OK" when test result is ok', () => { /* … */ });
it('Test button is disabled while there are validation issues', () => { /* … */ });
```

- [ ] **Step 4: Commit.**

```bash
npx vitest run src/components/features/connections/dialog-v2/__tests__/
git add src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx src/components/features/connections/dialog-v2/ConnectionDialogV2.module.css src/components/features/connections/dialog-v2/__tests__/ConnectionDialogV2.test.tsx
git commit -m "feat(dialog-v2): Test Connection button + staged-error footer"
```

---

## Task 16: ConnectionErrorDialog rendering for staged errors during connect

**Files:**
- Modify: `src/components/features/connections/ConnectionErrorDialog.tsx`
- Modify: `src/components/features/connections/__tests__/connection-error-dialog.test.tsx` (or create if absent)

- [ ] **Step 1: Read existing ConnectionErrorDialog.tsx** to see how it currently surfaces errors. The current shape is likely `{ message: string }`. New shape (additive): support `{ stage: BuildStage; error: string }` while keeping the legacy `{ message: string }` path for old-dialog callers.

- [ ] **Step 2: Update props.**

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  // either legacy or staged shape:
  error: string | { stage: BuildStage; error: string } | null;
}
```

Render branch: if `typeof error === 'string'`, render as plain text body. Otherwise render the stage as a heading + the error below (same `stageHeading` helper as Task 15 — hoist to `src/connection/ipc.ts` or a new `src/connection/staged-error.ts` so both consumers share it).

- [ ] **Step 3: Test** — render both shapes and assert the heading appears for the staged variant.

- [ ] **Step 4: Commit.**

```bash
git add src/components/features/connections/ConnectionErrorDialog.tsx src/components/features/connections/__tests__/connection-error-dialog.test.tsx src/connection/staged-error.ts
git commit -m "feat(connections): staged-error rendering in ConnectionErrorDialog"
```

---

## Task 17: connections_v2_connect + disconnect Rust IPC

**Files:**
- Modify: `src-tauri/src/commands/connection_v2.rs`
- Modify: `src-tauri/src/main.rs` (register handlers)
- Modify: `src/connection/ipc.ts` (add `connectV2`, `disconnectV2`)
- Modify: `src-tauri/tests/integration_connection.rs` (add 3 tests per spec §Testing)

- [ ] **Step 1: Implement `connections_v2_connect` and `connections_v2_disconnect`** in Rust.

```rust
// in commands/connection_v2.rs

#[derive(Debug, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectResultV2 {
    Connected,
    PassphraseRequired { connection_id: String },
    HostKeyUnknown {
        connection_id: String,
        fingerprint: String,
        algorithm: String,
        host: String,
        port: u16,
    },
}

#[tauri::command]
pub async fn connections_v2_connect(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    id: String,
    passphrase: Option<String>,
    accept_host_key: Option<bool>,
) -> Result<ConnectResultV2, BuildError> {
    // 1. Load connection from connections_v2.
    // 2. Resolve secrets from the SecretStore: auth-password, ssh-password,
    //    ssh-key-passphrase (or use the `passphrase` parameter from the retry),
    //    proxy-password, aws-secret-key.
    // 3. Build ResolvedConnection + EffectivePrefs.
    // 4. Call builder::build_client_options.
    // 5. On Err::Ssh with passphrase-required signal: return PassphraseRequired.
    //    On Err::Ssh with host-key-unknown signal: return HostKeyUnknown.
    // 6. Otherwise, instantiate mongodb::Client::with_options(opts).
    // 7. Store in state.mongo_clients + state.ssh_tunnels (if tunnel returned).
    // 8. Return Connected.
    unimplemented!()
}

#[tauri::command]
pub async fn connections_v2_disconnect(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Mirror legacy disconnect_connection: shutdown client (timeout 3s) then close tunnel.
    unimplemented!()
}
```

Reference existing `commands/connection.rs::connect_connection` for the SSH retry-state semantics; mirror them.

- [ ] **Step 2: Register both in main.rs's gated handler list.**

- [ ] **Step 3: Add `connectV2` / `disconnectV2` to `src/connection/ipc.ts`.**

```ts
export type ConnectResultV2 =
  | { type: 'connected' }
  | { type: 'passphraseRequired'; connectionId: string }
  | { type: 'hostKeyUnknown'; connectionId: string; fingerprint: string; algorithm: string; host: string; port: number };

export const connectV2 = (id: string, passphrase?: string, acceptHostKey?: boolean) =>
  invoke<ConnectResultV2>('connections_v2_connect', { id, passphrase, acceptHostKey });
export const disconnectV2 = (id: string) => invoke<void>('connections_v2_disconnect', { id });
```

- [ ] **Step 4: Add integration tests** per spec §Testing:

```rust
// in src-tauri/tests/integration_connection.rs
#[tokio::test] async fn connect_v2_success_returns_connected() { /* full happy path */ }
#[tokio::test] async fn connect_v2_passphrase_required_when_key_encrypted() { /* … */ }
#[tokio::test] async fn connect_v2_host_key_unknown_on_strict_policy() { /* … */ }
```

- [ ] **Step 5: Run.**

```bash
cargo test --bin mongo-lens commands::connection_v2
INTEGRATION=1 cargo test --test integration_connection -- --test-threads=1
```

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/commands/connection_v2.rs src-tauri/src/main.rs src/connection/ipc.ts src-tauri/tests/integration_connection.rs src-tauri/tests/common/mod.rs
git commit -m "feat(connection): connections_v2_connect + disconnect IPC + integration tests"
```

---

**End of PR 4.** All 8 tabs + Test button + staged-error UX functional behind the escape hatch. Before PR 5 cut-over: manually verify against a real cluster (Atlas SCRAM-SHA-256 + TLS, then SSH-tunneled cluster) with `DIALOG_V2=1 npm run tauri dev`.

---

# PR 5 — Cut-over

## Task 18: Wire v2 dialog in as the default + delete escape hatch

**Files:**
- Modify: `src/components/features/connections/ConnectionPanel.tsx`
- Delete: nothing yet (next task)

- [ ] **Step 1: In ConnectionPanel.tsx,** remove the escape-hatch branch. Always render `<ConnectionDialogV2 …>` for new + edit + duplicate flows. Delete the `<ConnectionDialog …>` import and JSX. Delete the env/URL check.

- [ ] **Step 2: Repoint useConnectionActions** at v2 IPC — the SSH passphrase / host-key challenge-response flow now calls `connectV2(id, passphrase, acceptHostKey)`. Same outcomes, same retry pattern.

- [ ] **Step 3: Run full UI tests.**

```bash
npm test
```
Expected: all green; the existing connection-panel tests that mocked the old dialog need updates to mock the new dialog instead (or be deleted if they're covered by the new ConnectionDialogV2 tests).

- [ ] **Step 4: Commit.**

```bash
git add src/components/features/connections/ConnectionPanel.tsx src/components/features/connections/useConnectionActions.ts src/components/features/connections/__tests__/
git commit -m "feat(connections): wire v2 dialog as default; drop escape hatch"
```

---

## Task 19: Delete old dialog files + legacy IPC + legacy store

**Files (delete):**
- `src/components/features/connections/ConnectionDialog.tsx`
- `src/components/features/connections/ConnectionDialog.module.css`
- `src/components/features/connections/__tests__/ConnectionDialog.test.tsx`
- `src/store/connections.ts`

**Files (modify):**
- `src-tauri/src/commands/connection.rs` — delete 7 legacy commands.
- `src-tauri/src/commands/mod.rs` — remove the `connection` re-exports.
- `src-tauri/src/main.rs` — remove the legacy handler registrations from the generate_handler! list.
- `src/ipc.ts` (legacy frontend wrappers, if any).
- Any test file referencing the deleted symbols.

- [ ] **Step 1: Delete the four files above** (`git rm`).

- [ ] **Step 2: Remove the 7 legacy commands** from `src-tauri/src/commands/connection.rs`: `list_connections`, `create_connection`, `update_connection`, `delete_connection`, `test_connection`, `connect_connection`, `disconnect_connection`. **Keep** `handle_session_loss` and `SshSessionLostPayload` — they're event emitters; verify nothing else in the file remains needed. If the file becomes empty, `git rm` it and remove `pub mod connection;` from `commands/mod.rs`.

- [ ] **Step 3: Repoint `commands/mod.rs` and `main.rs`** at the v2 surface only.

- [ ] **Step 4: Remove any frontend imports** of the legacy IPC wrappers from `src/ipc.ts` (or delete the file entirely if it's all legacy). `grep -rn "createConnection\|updateConnection\|deleteConnection\|connectConnection\|disconnectConnection\|listConnections\|testConnection" src/` and fix every site.

- [ ] **Step 5: Run cargo build + cargo test + npm test.** All must pass.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor(connection): delete old dialog + legacy IPC commands"
```

---

## Task 20: Drop CONN_V2 env gate + rename connections_v2 → connections

**Files:**
- Modify: `src-tauri/src/main.rs` — drop the runtime CONN_V2 branch; always register v2 handlers.
- Modify: `src-tauri/src/connection/migration.rs` — drop `CONN_V2` checks; always run.
- Create: `src-tauri/src/db/migrate.rs` migration step that renames `connections → connections_v1_backup` and `connections_v2 → connections`.
- Modify: `src-tauri/src/connection/store.rs` + `src-tauri/src/connection/schema_v2.sql` — update table name references.
- Modify: any other Rust callers.

- [ ] **Step 1: Add the schema migration step** in `src-tauri/src/db/migrate.rs` (follow existing migration patterns):

```rust
// Step N (where N is the next migration number):
fn migrate_rename_to_v1_backup(db: &Connection) -> Result<(), rusqlite::Error> {
    // Skip if connections_v2 doesn't exist (fresh install).
    let v2_exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='connections_v2')",
        [],
        |row| row.get(0),
    )?;
    if !v2_exists { return Ok(()); }

    // Atomic rename. SQLite DDL is auto-committed, but rusqlite wraps in a transaction.
    db.execute_batch(
        "ALTER TABLE connections RENAME TO connections_v1_backup;
         ALTER TABLE connections_v2 RENAME TO connections;",
    )?;
    Ok(())
}
```

- [ ] **Step 2: Update `schema_v2.sql`** — rename inside the file too so fresh installs (no v2 table yet) get the correct shape; or keep it as `connections_v2` and let the migration handle the rename. Whichever's idempotent. Document the choice in a `db/migrate.rs` comment.

- [ ] **Step 3: Update `store.rs`** to reference `connections` everywhere instead of `connections_v2`. Same for `commands/connection_v2.rs`. Same for `migration.rs::sync_row_to_v2` — once the table is the canonical `connections`, the sync-back from old dialog is no longer needed; we can simplify or remove `sync_row_to_v2`. Verify there are no remaining callers.

- [ ] **Step 4: Drop the `CONN_V2` env check** in `src-tauri/src/main.rs::run()` and in `connection::migration::bootstrap_conn_v2`. Always run migration. Always register v2 handlers.

- [ ] **Step 5: Update Cargo.toml feature default if needed.** `socks5-proxy` already defaults on; nothing to change.

- [ ] **Step 6: Run** `cargo build && cargo test --bin mongo-lens && INTEGRATION=1 cargo test --test integration_connection`. All must pass.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor(connection): rename connections_v2 → connections; drop CONN_V2 gate"
```

---

## Task 21: Smoke + PR

- [ ] **Step 1: Manual run.**

```bash
npm run tauri dev
```

- Open the app; new dialog opens for Add/Edit/Duplicate.
- Migrate legacy connections appear correctly with their secrets intact (verify by editing one and clicking Test).
- Color stripe shows in tree.
- Test button works (try against a real local mongod).
- Disconnect/reconnect lifecycle works.

- [ ] **Step 2: Tag and PR.**

```bash
git tag conn-dialog-phase2
git log --oneline conn-v2-phase1..HEAD | head -30   # sanity-check the PR scope
```

Open the PR with all PR-5 commits. The cut-over should be reviewable as a single coherent change (delete + rename + drop gate).

- [ ] **Step 3: Follow-up note in the PR.** "One release later, follow up to drop `connections_v1_backup` table — trivial migration step."

---

## Self-Review (against spec)

- **§Component Architecture** → Tasks 2 (TabSpec + registry), 4 (shell), 7 (AuthTab + sub-registry), 10 (SshTab + sub-registry).
- **§State Shape & IPC Wiring** → Tasks 1 (useConnectionsV2), 3 (useDialogState), 17 (connect_v2 / disconnect_v2 Rust).
- **§Validation flow** → Tasks 2, 4 (issues in shell), with sub-form validation already present in `src/connection/validation.ts` from Phase 1.
- **§Secrets handling** → ScramForm (Task 7) sets the pattern; reused in LegacyCrForm, LdapForm, KeyForm (SSH passphrase), ProxyTab, AwsIamForm.
- **§ConnectionTree changes** → Task 5 (color stripe + repoint to useConnectionsV2).
- **§Migration & rename** → Task 20 (rename + drop gate).
- **§Test button + staged errors** → Tasks 15, 16.
- **§Per-field overrides + globals** → Tasks 12, 13, 14.

**Placeholder scan:** A few "Pattern matches AuthTab" / "follow the ScramForm pattern" lines remain; those are intentional — the pattern is shown concretely once, and following it for the remaining sub-forms is a clear short step (20–40 lines each). Each sub-form has its specific data fields enumerated in Task 7 Step 3 and Task 10 Steps 2–3.

**Type consistency:** `SecretSlot` values used consistently — `auth-password`, `ssh-password`, `ssh-key-passphrase`, `proxy-password`, `aws-secret-key`. `BuildStage` values `ssh|tls|auth|ping`. Tab IDs consistent. AuthMode variant kinds consistent with spec.

**Scope check:** 5 PRs, each independently testable and reviewable. PRs 1–4 land additively (escape hatch); PR 5 is the deletion + rename cut-over. Follow-up release drops the backup table. Total ~21 tasks.
