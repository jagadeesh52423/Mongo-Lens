# DataFleet Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first dogfood Mongo Lens plugin — DataFleet — that runs the internal portal's Submit-Request + Get-Password flows from inside the app and writes the fetched password to an existing Mongo Lens connection.

**Architecture:** Two-part change. **Part A** (this repo) extends the plugin host with one new namespace (`mongolens.connections`) and surfaces two that already exist as backend classes but were never exposed (`mongolens.secrets`, `mongolens.workspace`). **Part B** is a standalone plugin folder (`plugin-packages/datafleet/`, gitignored) with its own toolchain (vitest, tsup, React) that uses those APIs through the existing sandbox.

**Tech Stack:** TypeScript, React 18, Vitest, Testing Library, Ajv, tsup. Plugin folder targets `dist/extension.js` as a single ESM bundle that the host loads via the existing blob-URL sandbox.

**Source of truth:** `docs/superpowers/specs/2026-05-13-datafleet-plugin-design.md`.

---

## File map

### Part A — host changes (Mongo Lens repo)

| File | Action | Responsibility |
|---|---|---|
| `src/plugins/permissions.ts` | Modify | Extend `KNOWN_SCOPE_KINDS` with `connections:write` |
| `src/plugins/api/contracts.ts` | Modify | Add `ConnectionRef`, `ConnectionsApi`, `WorkspaceApi`, `SecretsApi` types |
| `src/plugins/api/workspaceStore.ts` | Create | Tiny in-memory KV store (sibling of `secretStorage.ts`) |
| `src/plugins/hostServices.ts` | Modify | Add `connections`, `secrets`, `workspace` service implementations |
| `src/plugins/api/createMongolens.ts` | Modify | Expose the three new namespaces with permission checks + audit |
| `src/plugins/__tests__/permissions.test.ts` | Modify | Test `connections:write` parse + match |
| `src/plugins/api/__tests__/connections.test.ts` | Create | Test `list()` strips secrets, `updateCredentials` enforces perms + audits |
| `src/plugins/api/__tests__/workspace.test.ts` | Create | Test workspace KV namespacing + perm checks |
| `src/plugins/api/__tests__/secrets.test.ts` | Create | Test secrets namespacing + perm checks |
| `.gitignore` | Modify | Add `plugin-packages/` so the plugin sources don't go into this repo |

### Part B — DataFleet plugin (standalone folder)

Lives at `plugin-packages/datafleet/` in this worktree but **is not committed** (gitignored). After the work lands, you (the user) can move it to its own repo. Inside the folder:

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Create | Vitest + tsup + React + TypeScript deps |
| `tsconfig.json` | Create | Strict TS, ES2022 target, React JSX |
| `vitest.config.ts` | Create | jsdom env, setupFiles for `mongolens` global |
| `tsup.config.ts` | Create | Bundle `src/extension.ts` → `dist/extension.js` (ESM, no externals) |
| `manifest.json` | Create | Declarations: view, commands, permissions, activation events |
| `src/extension.ts` | Create | Plugin entry: register view + commands, wire DI |
| `src/api/types.ts` | Create | `PortalClient` interface, `PortalError`, request/response types |
| `src/api/datafleetClient.ts` | Create | Default `PortalClient` impl using `mongolens.net.fetch` |
| `src/store/requestStore.ts` | Create | Persisted request list (zod-validated) over `mongolens.workspace` |
| `src/store/credsStore.ts` | Create | LDAP creds over `mongolens.secrets` |
| `src/ui/NewRequestForm.tsx` | Create | SR submit form |
| `src/ui/AttachConnectionPicker.tsx` | Create | Connection list + confirmation |
| `src/ui/RequestsView.tsx` | Create | Side-panel composition: list + actions |
| `src/__tests__/datafleetClient.test.ts` | Create | Every documented status enum, both flows |
| `src/__tests__/requestStore.test.ts` | Create | Round-trip, schema drop, namespace |
| `src/__tests__/credsStore.test.ts` | Create | Round-trip, missing key, malformed JSON |
| `src/__tests__/NewRequestForm.test.tsx` | Create | Validation, submit, error mapping |
| `src/__tests__/AttachConnectionPicker.test.tsx` | Create | List, confirm, no-password-leak |
| `src/__tests__/RequestsView.test.tsx` | Create | State transitions, integration |

---

## Part A — host changes

### Task 1: Add `connections:write` to known scope kinds

**Files:**
- Modify: `src/plugins/permissions.ts`
- Test:   `src/plugins/__tests__/permissions.test.ts`

- [ ] **Step 1: Add the failing test**

Append this block to `src/plugins/__tests__/permissions.test.ts` (inside the existing `describe` for parseScope/matchesScope):

```ts
describe('connections:write scope', () => {
  it('parses connections:write as a known scope', () => {
    expect(parseScope('connections:write')).toEqual({ kind: 'connections:write' });
  });

  it('rejects connections:read (not in known kinds yet)', () => {
    expect(() => parseScope('connections:read')).toThrow(/Unknown scope kind/);
  });

  it('matches granted connections:write against requested connections:write', () => {
    expect(matchesScope([{ kind: 'connections:write' }], { kind: 'connections:write' })).toBe(true);
  });

  it('does not match when not granted', () => {
    expect(matchesScope([{ kind: 'secrets:read' }], { kind: 'connections:write' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/plugins/__tests__/permissions.test.ts`
Expected: 4 new tests fail with "Unknown scope kind 'connections:write'".

- [ ] **Step 3: Add the scope kind**

In `src/plugins/permissions.ts`, change `KNOWN_SCOPE_KINDS` to:

```ts
export const KNOWN_SCOPE_KINDS = [
  'database:read', 'database:write',
  'network:fetch',
  'secrets:read', 'secrets:write',
  'workspace:read', 'workspace:write',
  'connections:write',
] as const;
```

- [ ] **Step 4: Run tests — pass**

Run: `npx vitest run src/plugins/__tests__/permissions.test.ts`
Expected: all pass (including the four new ones).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/permissions.ts src/plugins/__tests__/permissions.test.ts
git commit -m "feat(plugins): add connections:write permission scope"
```

---

### Task 2: Define `ConnectionRef`, `ConnectionsApi`, `SecretsApi`, `WorkspaceApi`

**Files:**
- Modify: `src/plugins/api/contracts.ts`

- [ ] **Step 1: Append types to contracts.ts**

Append to `src/plugins/api/contracts.ts`:

```ts
export interface ConnectionRef {
  id: string;
  name: string;
  host?: string;
  port?: number;
  username?: string;
}

export interface ConnectionsApi {
  list(): Promise<ConnectionRef[]>;
  updateCredentials(id: string, creds: { password: string }): Promise<void>;
}

export interface SecretsApi {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkspaceApi {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
```

- [ ] **Step 2: Verify TS still compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/api/contracts.ts
git commit -m "feat(plugins): add Connections/Secrets/Workspace API types"
```

---

### Task 3: Create the in-memory `WorkspaceStore` backend

**Files:**
- Create: `src/plugins/api/workspaceStore.ts`
- Create: `src/plugins/api/__tests__/workspaceStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/plugins/api/__tests__/workspaceStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkspaceStore, namespaceFor } from '../workspaceStore';

describe('InMemoryWorkspaceStore', () => {
  let store: InMemoryWorkspaceStore;
  beforeEach(() => { store = new InMemoryWorkspaceStore(); });

  it('returns undefined for missing keys', async () => {
    expect(await store.get('k')).toBeUndefined();
  });

  it('round-trips set/get/delete', async () => {
    await store.set('k', 'v');
    expect(await store.get('k')).toBe('v');
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('lists keys', async () => {
    await store.set('a', '1');
    await store.set('b', '2');
    expect((await store.keys()).sort()).toEqual(['a', 'b']);
  });

  it('namespaceFor produces plugin:<id>:<key>', () => {
    expect(namespaceFor('datafleet', 'requests')).toBe('plugin:datafleet:requests');
  });
});
```

- [ ] **Step 2: Run — fails (module not found)**

Run: `npx vitest run src/plugins/api/__tests__/workspaceStore.test.ts`
Expected: FAIL — `Cannot find module '../workspaceStore'`.

- [ ] **Step 3: Create the module**

Create `src/plugins/api/workspaceStore.ts`:

```ts
export interface WorkspaceStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private map = new Map<string, string>();
  async get(k: string) { return this.map.get(k); }
  async set(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async keys() { return [...this.map.keys()]; }
}

export function namespaceFor(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/plugins/api/__tests__/workspaceStore.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/api/workspaceStore.ts src/plugins/api/__tests__/workspaceStore.test.ts
git commit -m "feat(plugins): add InMemoryWorkspaceStore backend"
```

---

### Task 4: Extend `HostServices` with `connections`, `secrets`, `workspace`

**Files:**
- Modify: `src/plugins/hostServices.ts`

- [ ] **Step 1: Update HostServices**

Replace the contents of `src/plugins/hostServices.ts` with:

```ts
import { PermissionBroker } from './PermissionBroker';
import { SecretStorage, namespaceFor as nsSecret } from './api/secretStorage';
import { WorkspaceStore, namespaceFor as nsWorkspace } from './api/workspaceStore';
import { ConnectionRef } from './api/contracts';

export interface HostBackend {
  dbFind(args: { coll: string; filter: unknown; opts?: unknown }): Promise<unknown[]>;
  netFetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }>;
  connectionsList(): Promise<ConnectionRef[]>;
  connectionsUpdateCredentials(id: string, password: string): Promise<void>;
}

export interface AuditEvent {
  pluginId: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
  at: string;
}

export type AuditSink = (event: AuditEvent) => void;

export interface HostServices {
  db:          { find(coll: string, filter: unknown, opts?: unknown): Promise<unknown[]> };
  net:         { fetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }> };
  connections: { list(): Promise<ConnectionRef[]>; updateCredentials(id: string, creds: { password: string }): Promise<void> };
  secrets:     { get(k: string): Promise<string | undefined>; store(k: string, v: string): Promise<void>; delete(k: string): Promise<void> };
  workspace:   { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void>; delete(k: string): Promise<void>; keys(): Promise<string[]> };
}

export function createHostServices(params: {
  broker: PermissionBroker;
  pluginId: string;
  backend: HostBackend;
  secrets: SecretStorage;
  workspace: WorkspaceStore;
  audit?: AuditSink;
}): HostServices {
  const { broker, pluginId, backend, secrets, workspace, audit } = params;
  const now = () => new Date().toISOString();
  return {
    db: {
      async find(coll, filter, opts) {
        broker.check(pluginId, { kind: 'database:read' });
        return backend.dbFind({ coll, filter, opts });
      },
    },
    net: {
      async fetch(url, init) {
        broker.check(pluginId, { kind: 'network:fetch', arg: url });
        return backend.netFetch(url, init);
      },
    },
    connections: {
      async list() {
        broker.check(pluginId, { kind: 'connections:write' });
        return backend.connectionsList();
      },
      async updateCredentials(id, { password }) {
        broker.check(pluginId, { kind: 'connections:write' });
        if (typeof password !== 'string' || password.length === 0) {
          throw new TypeError('updateCredentials requires a non-empty password');
        }
        await backend.connectionsUpdateCredentials(id, password);
        audit?.({ pluginId, action: 'connections.updateCredentials', target: id, at: now() });
      },
    },
    secrets: {
      async get(k)        { broker.check(pluginId, { kind: 'secrets:read'  }); return secrets.get(nsSecret(pluginId, k)); },
      async store(k, v)   { broker.check(pluginId, { kind: 'secrets:write' }); return secrets.store(nsSecret(pluginId, k), v); },
      async delete(k)     { broker.check(pluginId, { kind: 'secrets:write' }); return secrets.delete(nsSecret(pluginId, k)); },
    },
    workspace: {
      async get(k)        { broker.check(pluginId, { kind: 'workspace:read'  }); return workspace.get(nsWorkspace(pluginId, k)); },
      async set(k, v)     { broker.check(pluginId, { kind: 'workspace:write' }); return workspace.set(nsWorkspace(pluginId, k), v); },
      async delete(k)     { broker.check(pluginId, { kind: 'workspace:write' }); return workspace.delete(nsWorkspace(pluginId, k)); },
      async keys() {
        broker.check(pluginId, { kind: 'workspace:read' });
        const prefix = nsWorkspace(pluginId, '');
        return (await workspace.keys()).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
      },
    },
  };
}
```

- [ ] **Step 2: TS compile check**

Run: `npx tsc --noEmit`
Expected: errors at every caller of `createHostServices` (they pass an old shape).

- [ ] **Step 3: Fix call sites**

`createHostServices` is now called with new required params (`secrets`, `workspace`, optional `audit`, and a richer `backend`). Update every call site so it compiles. Search:

```bash
grep -rn "createHostServices\|createMongolens\|HostBackend" src --include="*.ts" --include="*.tsx" | grep -v __tests__
```

For each caller:
- Construct `secrets` with `new InMemorySecretStorage()` and `workspace` with `new InMemoryWorkspaceStore()`.
- Extend the `backend` with stubs that return `[]` or throw `Error('not wired')` for the new methods. The real wiring lands in Task 5 inside `src/App.tsx`.

- [ ] **Step 4: TS compile clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/hostServices.ts $(grep -rl "createHostServices" src --include="*.ts" --include="*.tsx" | grep -v __tests__ | tr '\n' ' ')
git commit -m "feat(plugins): extend HostServices with connections/secrets/workspace"
```

---

### Task 5: Wire the real backend for connections in `src/App.tsx`

**Files:**
- Modify: `src/App.tsx` (the plugin bootstrap useEffect added by the host work)

- [ ] **Step 1: Find the existing bootstrap**

Run: `grep -n "createPluginHost\|HostBackend" src/App.tsx`. The bootstrap creates a `HostBackend` already. Locate where `db.find` and `net.fetch` are wired.

- [ ] **Step 2: Add connections wiring**

Inside that same `HostBackend` literal, add:

```ts
async connectionsList() {
  const { listConnections } = await import('./ipc');
  const all = await listConnections();
  return all.map(c => ({
    id: c.id, name: c.name, host: c.host, port: c.port, username: c.username,
  }));
},
async connectionsUpdateCredentials(id, password) {
  const { updateConnection, listConnections } = await import('./ipc');
  const current = (await listConnections()).find(c => c.id === id);
  if (!current) throw new Error('Connection not found');
  // Pass through the existing record so we only touch the password field.
  const { id: _id, createdAt: _createdAt, ...input } = current;
  await updateConnection(id, { ...input, password });
},
```

Also pass `secrets: new InMemorySecretStorage()` and `workspace: new InMemoryWorkspaceStore()` to `createHostServices` (importing the new classes from the right paths).

- [ ] **Step 3: Manual sanity**

Run: `npm run build`
Expected: build succeeds. (Runtime test happens in Task 17.)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(plugins): wire connections backend for plugin host"
```

---

### Task 6: Expose `connections`/`secrets`/`workspace` through `MongolensAPI`

**Files:**
- Modify: `src/plugins/api/createMongolens.ts`

- [ ] **Step 1: Update the interface**

Add to `MongolensAPI`:

```ts
connections: HostServices['connections'];
secrets:     HostServices['secrets'];
workspace:   HostServices['workspace'];
```

- [ ] **Step 2: Update the factory return**

In the `return {…}` literal, after `db: services.db, net: services.net,` add:

```ts
connections: services.connections,
secrets:     services.secrets,
workspace:   services.workspace,
```

- [ ] **Step 3: TS compile**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/api/createMongolens.ts
git commit -m "feat(plugins): expose connections/secrets/workspace via MongolensAPI"
```

---

### Task 7: Unit tests — `connections` API

**Files:**
- Create: `src/plugins/api/__tests__/connections.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createHostServices, type HostBackend } from '../../hostServices';
import { PermissionBroker } from '../../PermissionBroker';
import { InMemorySecretStorage } from '../secretStorage';
import { InMemoryWorkspaceStore } from '../workspaceStore';

function makeBackend(overrides: Partial<HostBackend> = {}): HostBackend {
  return {
    dbFind: vi.fn(async () => []),
    netFetch: vi.fn(async () => ({ status: 200 })),
    connectionsList: vi.fn(async () => [
      { id: '1', name: 'staging', host: 'h', port: 27017, username: 'u' },
    ]),
    connectionsUpdateCredentials: vi.fn(async () => {}),
    ...overrides,
  };
}

function setup(grants: string[] = ['connections:write']) {
  const broker = new PermissionBroker();
  broker.setGrants('datafleet', grants.map(g => {
    const [k] = [g];
    return { kind: k as never };
  }));
  const audit = vi.fn();
  const backend = makeBackend();
  const services = createHostServices({
    broker, pluginId: 'datafleet', backend,
    secrets: new InMemorySecretStorage(),
    workspace: new InMemoryWorkspaceStore(),
    audit,
  });
  return { services, backend, audit };
}

describe('connections API', () => {
  it('list returns refs', async () => {
    const { services } = setup();
    const refs = await services.connections.list();
    expect(refs).toEqual([{ id: '1', name: 'staging', host: 'h', port: 27017, username: 'u' }]);
  });

  it('list requires connections:write', async () => {
    const { services } = setup([]); // no grants
    await expect(services.connections.list()).rejects.toThrow(/permission/i);
  });

  it('updateCredentials calls backend and emits audit', async () => {
    const { services, backend, audit } = setup();
    await services.connections.updateCredentials('1', { password: 'pw' });
    expect(backend.connectionsUpdateCredentials).toHaveBeenCalledWith('1', 'pw');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'datafleet',
      action: 'connections.updateCredentials',
      target: '1',
    }));
  });

  it('updateCredentials rejects empty password', async () => {
    const { services } = setup();
    await expect(services.connections.updateCredentials('1', { password: '' }))
      .rejects.toThrow(/non-empty/);
  });

  it('updateCredentials requires connections:write', async () => {
    const { services } = setup([]);
    await expect(services.connections.updateCredentials('1', { password: 'pw' }))
      .rejects.toThrow(/permission/i);
  });
});
```

- [ ] **Step 2: Run — passes**

Run: `npx vitest run src/plugins/api/__tests__/connections.test.ts`
Expected: 5 pass.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/api/__tests__/connections.test.ts
git commit -m "test(plugins): connections API list+updateCredentials+audit+perm checks"
```

---

### Task 8: Unit tests — `secrets` and `workspace` namespacing

**Files:**
- Create: `src/plugins/api/__tests__/secretsAndWorkspace.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createHostServices, type HostBackend } from '../../hostServices';
import { PermissionBroker } from '../../PermissionBroker';
import { InMemorySecretStorage } from '../secretStorage';
import { InMemoryWorkspaceStore } from '../workspaceStore';

function setup(grants: Array<{kind: string}>) {
  const broker = new PermissionBroker();
  broker.setGrants('p1', grants as never);
  const backend: HostBackend = {
    dbFind: vi.fn(async () => []),
    netFetch: vi.fn(async () => ({ status: 200 })),
    connectionsList: vi.fn(async () => []),
    connectionsUpdateCredentials: vi.fn(async () => {}),
  };
  const secrets = new InMemorySecretStorage();
  const workspace = new InMemoryWorkspaceStore();
  return {
    services: createHostServices({ broker, pluginId: 'p1', backend, secrets, workspace }),
    secrets, workspace,
  };
}

describe('secrets API', () => {
  it('namespaces keys under plugin:<id>:', async () => {
    const { services, secrets } = setup([{kind:'secrets:read'},{kind:'secrets:write'}]);
    await services.secrets.store('k', 'v');
    expect(await secrets.get('plugin:p1:k')).toBe('v');
    expect(await services.secrets.get('k')).toBe('v');
  });

  it('store requires secrets:write', async () => {
    const { services } = setup([{kind:'secrets:read'}]);
    await expect(services.secrets.store('k', 'v')).rejects.toThrow(/permission/i);
  });
});

describe('workspace API', () => {
  it('namespaces keys and returns un-prefixed keys()', async () => {
    const { services, workspace } = setup([{kind:'workspace:read'},{kind:'workspace:write'}]);
    await services.workspace.set('a', '1');
    await services.workspace.set('b', '2');
    expect(await workspace.get('plugin:p1:a')).toBe('1');
    expect((await services.workspace.keys()).sort()).toEqual(['a', 'b']);
  });

  it('keys() does not see other plugins\' data', async () => {
    const { workspace } = setup([{kind:'workspace:read'},{kind:'workspace:write'}]);
    await workspace.set('plugin:other:x', '1');
    // Build a fresh services for p1 sharing the same workspace store
    const broker = new PermissionBroker();
    broker.setGrants('p1', [{kind:'workspace:read'},{kind:'workspace:write'}] as never);
    const backend: HostBackend = {
      dbFind: vi.fn(), netFetch: vi.fn(),
      connectionsList: vi.fn(async () => []),
      connectionsUpdateCredentials: vi.fn(async () => {}),
    };
    const s = createHostServices({
      broker, pluginId: 'p1', backend,
      secrets: new InMemorySecretStorage(), workspace,
    });
    expect(await s.workspace.keys()).toEqual([]);
  });

  it('set requires workspace:write', async () => {
    const { services } = setup([{kind:'workspace:read'}]);
    await expect(services.workspace.set('k', 'v')).rejects.toThrow(/permission/i);
  });
});
```

- [ ] **Step 2: Run — passes**

Run: `npx vitest run src/plugins/api/__tests__/secretsAndWorkspace.test.ts`
Expected: 5 pass.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/api/__tests__/secretsAndWorkspace.test.ts
git commit -m "test(plugins): secrets+workspace namespacing and perm checks"
```

---

### Task 9: Add `plugin-packages/` to .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append**

Append to `.gitignore`:

```
# Standalone plugin source folders (kept out of the main repo)
plugin-packages/
```

- [ ] **Step 2: Verify**

Run: `git check-ignore -v plugin-packages/datafleet 2>/dev/null && echo IGNORED`
Expected: prints `IGNORED` (after Part B creates the folder).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore plugin-packages/"
```

---

## Part B — DataFleet plugin (in `plugin-packages/datafleet/`)

**Working directory for all of Part B:** `plugin-packages/datafleet/` (created in Task 10).

### Task 10: Scaffold the plugin folder

**Files (new):**
- `plugin-packages/datafleet/package.json`
- `plugin-packages/datafleet/tsconfig.json`
- `plugin-packages/datafleet/vitest.config.ts`
- `plugin-packages/datafleet/tsup.config.ts`
- `plugin-packages/datafleet/src/__tests__/setup.ts`

- [ ] **Step 1: Create folder**

```bash
mkdir -p plugin-packages/datafleet/src/{api,store,ui,__tests__}
mkdir -p plugin-packages/datafleet/dist
cd plugin-packages/datafleet
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "mongolens-plugin-datafleet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^14.2.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
```

- [ ] **Step 5: Write `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['esm'],
  bundle: true,
  splitting: false,
  treeshake: true,
  sourcemap: true,
  clean: true,
  // Bundle everything (including React) so the plugin works in the sandbox
  // without depending on host-provided modules.
  noExternal: [/.*/],
  target: 'es2022',
  outDir: 'dist',
});
```

- [ ] **Step 6: Write `src/__tests__/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 7: Install deps**

Run: `npm install`
Expected: succeeds.

- [ ] **Step 8: Sanity build/test (no source yet, so test reports nothing)**

Run: `npm run typecheck`
Expected: 0 errors (no files to check).

- [ ] **Step 9: Note — do NOT commit (gitignored)**

This folder is intentionally outside git. Verify with: `git check-ignore plugin-packages/datafleet/package.json` — should print the path.

---

### Task 11: Manifest

**Files:**
- Create: `plugin-packages/datafleet/manifest.json`

- [ ] **Step 1: Write the manifest**

```json
{
  "$schema": "../../src-tauri/gen/schemas/plugin-manifest.json",
  "id": "datafleet",
  "name": "DataFleet",
  "version": "0.1.0",
  "engines": { "mongolens": "^1.0.0" },
  "main": "dist/extension.js",
  "activationEvents": ["onView:datafleet.requests"],
  "permissions": [
    "network:fetch:https://o7yd4zabrg.execute-api.ap-south-1.amazonaws.com/*",
    "connections:write",
    "secrets:read",
    "secrets:write",
    "workspace:read",
    "workspace:write"
  ],
  "contributes": {
    "views": [
      { "id": "datafleet.requests", "title": "DataFleet", "location": "sidebar" }
    ],
    "commands": [
      { "id": "datafleet.newRequest",         "title": "DataFleet: New Request" },
      { "id": "datafleet.fetchPassword",      "title": "DataFleet: Fetch Password" },
      { "id": "datafleet.attachToConnection", "title": "DataFleet: Attach Password to Connection" }
    ]
  }
}
```

The `$schema` line is informational; if the host's manifest schema is at a different path it'll be ignored. We don't run validation here; the host does on install.

---

### Task 12: `PortalClient` types

**Files:**
- Create: `plugin-packages/datafleet/src/api/types.ts`

- [ ] **Step 1: Write the types**

```ts
export type Purpose = 'RM-Checkout' | 'Tech-Support' | 'Prod-Issue';
export type MongoApp = 'los' | 'lms' | 'eve' | 'e2live' | 'ffr';

export interface LdapCreds { username: string; password: string }

export interface SubmitRequestArgs {
  creds: LdapCreds;
  purpose: Purpose;
  linkedTicket: string;
  mongoApps: MongoApp[];
}
export type SubmitRequestResult =
  | { ok: true; jiraTicket: string }
  | { ok: false; reason: 'AUTH_FAILED' | 'LINKED_TICKET_INVALID' | 'ACCESS_EXISTS' | 'TS_NA' };

export interface FetchPasswordArgs { creds: LdapCreds; reqId: string }
export type FetchPasswordResult =
  | { ok: true; password: string }
  | { ok: false; reason: 'AUTH_FAILED' | 'REQ_NOT_APPROVED' | 'REQ_REJECTED' | 'REQ_EXPIRED' | 'ACCESS_EXISTS' };

// implement this interface to add a new portal backend
export interface PortalClient {
  submitRequest(args: SubmitRequestArgs): Promise<SubmitRequestResult>;
  fetchPassword(args: FetchPasswordArgs): Promise<FetchPasswordResult>;
}

export class PortalNetworkError extends Error {
  constructor(public status: number, public body?: unknown) {
    super(`Portal network error: HTTP ${status}`);
    this.name = 'PortalNetworkError';
  }
}
```

- [ ] **Step 2: TS check**

Run: `npm run typecheck` (from `plugin-packages/datafleet/`)
Expected: 0 errors.

---

### Task 13: `DataFleetClient` implementation

**Files:**
- Create: `plugin-packages/datafleet/src/api/datafleetClient.ts`
- Create: `plugin-packages/datafleet/src/__tests__/datafleetClient.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { DataFleetClient } from '../api/datafleetClient';

function makeFetch(response: { status: number; body?: unknown }) {
  return vi.fn(async () => response);
}

const URL = 'https://o7yd4zabrg.execute-api.ap-south-1.amazonaws.com/datafleet';

describe('DataFleetClient.submitRequest', () => {
  it('returns jira_ticket on AUTH SUCCESS', async () => {
    const fetchMock = makeFetch({ status: 200, body: { status: 'AUTH SUCCESS', jira_ticket: 'MPMW-42' } });
    const client = new DataFleetClient({ fetch: fetchMock, url: URL });
    const r = await client.submitRequest({
      creds: { username: 'u', password: 'p' },
      purpose: 'RM-Checkout', linkedTicket: 'MPMW-1', mongoApps: ['los'],
    });
    expect(r).toEqual({ ok: true, jiraTicket: 'MPMW-42' });
    expect(fetchMock).toHaveBeenCalledWith(URL, expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"source":"SR"'),
    }));
  });

  it('maps each portal error status', async () => {
    const cases: Array<[string, string]> = [
      ['LINKED TICKET NOT VALID', 'LINKED_TICKET_INVALID'],
      ['ACCESS ALREADY EXISTS', 'ACCESS_EXISTS'],
      ['TS-NA', 'TS_NA'],
      ['anything else', 'AUTH_FAILED'],
    ];
    for (const [serverStatus, mapped] of cases) {
      const fetchMock = makeFetch({ status: 200, body: { status: serverStatus } });
      const client = new DataFleetClient({ fetch: fetchMock, url: URL });
      const r = await client.submitRequest({
        creds: { username: 'u', password: 'p' },
        purpose: 'RM-Checkout', linkedTicket: 'MPMW-1', mongoApps: ['los'],
      });
      expect(r).toEqual({ ok: false, reason: mapped });
    }
  });

  it('throws PortalNetworkError on non-2xx', async () => {
    const fetchMock = makeFetch({ status: 503 });
    const client = new DataFleetClient({ fetch: fetchMock, url: URL });
    await expect(client.submitRequest({
      creds: { username: 'u', password: 'p' },
      purpose: 'RM-Checkout', linkedTicket: 'MPMW-1', mongoApps: ['los'],
    })).rejects.toThrow(/HTTP 503/);
  });
});

describe('DataFleetClient.fetchPassword', () => {
  it('returns password on REQ APPROVED', async () => {
    const fetchMock = makeFetch({ status: 200, body: { status: 'REQ APPROVED', pwd: 'secret' } });
    const client = new DataFleetClient({ fetch: fetchMock, url: URL });
    expect(await client.fetchPassword({ creds: { username: 'u', password: 'p' }, reqId: 'DF-1' }))
      .toEqual({ ok: true, password: 'secret' });
  });

  it('maps each portal error status', async () => {
    const cases: Array<[string, string]> = [
      ['REQ NOT APPROVED', 'REQ_NOT_APPROVED'],
      ['REQ REJECTED', 'REQ_REJECTED'],
      ['REQ EXPIRED', 'REQ_EXPIRED'],
      ['ACCESS ALREADY EXISTS', 'ACCESS_EXISTS'],
      ['anything else', 'AUTH_FAILED'],
    ];
    for (const [serverStatus, mapped] of cases) {
      const fetchMock = makeFetch({ status: 200, body: { status: serverStatus } });
      const client = new DataFleetClient({ fetch: fetchMock, url: URL });
      const r = await client.fetchPassword({ creds: { username: 'u', password: 'p' }, reqId: 'DF-1' });
      expect(r).toEqual({ ok: false, reason: mapped });
    }
  });
});
```

- [ ] **Step 2: Run — fails (module not found)**

Run: `npm test -- datafleetClient`
Expected: import error.

- [ ] **Step 3: Write the client**

`plugin-packages/datafleet/src/api/datafleetClient.ts`:

```ts
import type {
  PortalClient, SubmitRequestArgs, SubmitRequestResult,
  FetchPasswordArgs, FetchPasswordResult,
} from './types';
import { PortalNetworkError } from './types';

type Fetch = (url: string, init?: unknown) => Promise<{ status: number; body?: unknown }>;

interface SrBody { status: string; jira_ticket?: string }
interface GpBody { status: string; pwd?: string }

export class DataFleetClient implements PortalClient {
  constructor(private deps: { fetch: Fetch; url: string }) {}

  async submitRequest(args: SubmitRequestArgs): Promise<SubmitRequestResult> {
    const application: { mongo?: string } = {};
    if (args.mongoApps.length > 0) application.mongo = args.mongoApps.join(',');
    const body = {
      source: 'SR',
      username: args.creds.username,
      password: args.creds.password,
      purpose: args.purpose,
      linked_ticket: args.linkedTicket,
      application,
    };
    const res = await this.deps.fetch(this.deps.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) throw new PortalNetworkError(res.status, res.body);
    const parsed = res.body as SrBody;
    switch (parsed.status) {
      case 'AUTH SUCCESS':
        if (!parsed.jira_ticket) return { ok: false, reason: 'AUTH_FAILED' };
        return { ok: true, jiraTicket: parsed.jira_ticket };
      case 'LINKED TICKET NOT VALID': return { ok: false, reason: 'LINKED_TICKET_INVALID' };
      case 'ACCESS ALREADY EXISTS':   return { ok: false, reason: 'ACCESS_EXISTS' };
      case 'TS-NA':                   return { ok: false, reason: 'TS_NA' };
      default:                        return { ok: false, reason: 'AUTH_FAILED' };
    }
  }

  async fetchPassword(args: FetchPasswordArgs): Promise<FetchPasswordResult> {
    const body = {
      source: 'GP',
      username: args.creds.username,
      password: args.creds.password,
      reqId: args.reqId,
    };
    const res = await this.deps.fetch(this.deps.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) throw new PortalNetworkError(res.status, res.body);
    const parsed = res.body as GpBody;
    switch (parsed.status) {
      case 'REQ APPROVED':
        if (!parsed.pwd) return { ok: false, reason: 'AUTH_FAILED' };
        return { ok: true, password: parsed.pwd };
      case 'REQ NOT APPROVED':       return { ok: false, reason: 'REQ_NOT_APPROVED' };
      case 'REQ REJECTED':           return { ok: false, reason: 'REQ_REJECTED' };
      case 'REQ EXPIRED':            return { ok: false, reason: 'REQ_EXPIRED' };
      case 'ACCESS ALREADY EXISTS':  return { ok: false, reason: 'ACCESS_EXISTS' };
      default:                       return { ok: false, reason: 'AUTH_FAILED' };
    }
  }
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- datafleetClient`
Expected: 8+ tests pass.

---

### Task 14: `RequestStore` (workspace-backed, zod-validated)

**Files:**
- Create: `plugin-packages/datafleet/src/store/requestStore.ts`
- Create: `plugin-packages/datafleet/src/__tests__/requestStore.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RequestStore, type PersistedRequest } from '../store/requestStore';

function makeWorkspace() {
  const map = new Map<string, string>();
  return {
    get: async (k: string) => map.get(k),
    set: async (k: string, v: string) => { map.set(k, v); },
    delete: async (k: string) => { map.delete(k); },
    keys: async () => [...map.keys()],
    _map: map,
  };
}

const sample: PersistedRequest = {
  id: 'MPMW-1', purpose: 'RM-Checkout', apps: ['los'], linkedTicket: 'MPMW-1',
  status: 'pending', createdAt: '2026-05-13T00:00:00Z',
};

describe('RequestStore', () => {
  let ws: ReturnType<typeof makeWorkspace>;
  let store: RequestStore;
  beforeEach(() => { ws = makeWorkspace(); store = new RequestStore(ws); });

  it('returns [] when nothing is stored', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('round-trips add/list', async () => {
    await store.add(sample);
    expect(await store.list()).toEqual([sample]);
  });

  it('updateStatus mutates the matching row only', async () => {
    await store.add(sample);
    await store.add({ ...sample, id: 'MPMW-2' });
    await store.updateStatus('MPMW-1', 'used');
    const list = await store.list();
    expect(list.find(r => r.id === 'MPMW-1')!.status).toBe('used');
    expect(list.find(r => r.id === 'MPMW-2')!.status).toBe('pending');
  });

  it('drops corrupt entries on load', async () => {
    await ws.set('requests', JSON.stringify([sample, { not: 'valid' }, { ...sample, id: 'MPMW-3' }]));
    expect((await store.list()).map(r => r.id)).toEqual(['MPMW-1', 'MPMW-3']);
  });

  it('drops everything when value is not JSON', async () => {
    await ws.set('requests', 'not-json{');
    expect(await store.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm test -- requestStore`
Expected: import error.

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod';

const PurposeSchema = z.enum(['RM-Checkout', 'Tech-Support', 'Prod-Issue']);
const AppSchema = z.enum(['los', 'lms', 'eve', 'e2live', 'ffr']);
const StatusSchema = z.enum(['pending', 'ready', 'used', 'rejected', 'expired', 'already_exists']);

const PersistedRequestSchema = z.object({
  id: z.string(),
  purpose: PurposeSchema,
  apps: z.array(AppSchema),
  linkedTicket: z.string(),
  status: StatusSchema,
  createdAt: z.string(),
});
export type PersistedRequest = z.infer<typeof PersistedRequestSchema>;
export type RequestStatus = z.infer<typeof StatusSchema>;

interface WorkspaceApi {
  get(k: string): Promise<string | undefined>;
  set(k: string, v: string): Promise<void>;
}

const KEY = 'requests';

export class RequestStore {
  constructor(private workspace: WorkspaceApi) {}

  async list(): Promise<PersistedRequest[]> {
    const raw = await this.workspace.get(KEY);
    if (!raw) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(parsed)) return [];
    const out: PersistedRequest[] = [];
    for (const item of parsed) {
      const r = PersistedRequestSchema.safeParse(item);
      if (r.success) out.push(r.data);
    }
    return out;
  }

  async add(req: PersistedRequest): Promise<void> {
    const list = await this.list();
    list.push(req);
    await this.workspace.set(KEY, JSON.stringify(list));
  }

  async updateStatus(id: string, status: RequestStatus): Promise<void> {
    const list = await this.list();
    const updated = list.map(r => r.id === id ? { ...r, status } : r);
    await this.workspace.set(KEY, JSON.stringify(updated));
  }

  async remove(id: string): Promise<void> {
    const list = await this.list();
    await this.workspace.set(KEY, JSON.stringify(list.filter(r => r.id !== id)));
  }
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- requestStore`
Expected: 5 pass.

---

### Task 15: `CredsStore` (secrets-backed)

**Files:**
- Create: `plugin-packages/datafleet/src/store/credsStore.ts`
- Create: `plugin-packages/datafleet/src/__tests__/credsStore.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CredsStore } from '../store/credsStore';

function makeSecrets() {
  const map = new Map<string, string>();
  return {
    get: async (k: string) => map.get(k),
    store: async (k: string, v: string) => { map.set(k, v); },
    delete: async (k: string) => { map.delete(k); },
  };
}

describe('CredsStore', () => {
  let secrets: ReturnType<typeof makeSecrets>;
  let store: CredsStore;
  beforeEach(() => { secrets = makeSecrets(); store = new CredsStore(secrets); });

  it('returns undefined when missing', async () => {
    expect(await store.load()).toBeUndefined();
  });

  it('round-trips save/load', async () => {
    await store.save({ username: 'u', password: 'p' });
    expect(await store.load()).toEqual({ username: 'u', password: 'p' });
  });

  it('treats malformed JSON as missing and self-heals', async () => {
    await secrets.store('ldap', 'not-json{');
    expect(await store.load()).toBeUndefined();
  });

  it('treats wrong shape as missing', async () => {
    await secrets.store('ldap', JSON.stringify({ user: 'x' }));
    expect(await store.load()).toBeUndefined();
  });

  it('clear removes', async () => {
    await store.save({ username: 'u', password: 'p' });
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm test -- credsStore`
Expected: import error.

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod';

const Schema = z.object({ username: z.string().min(1), password: z.string().min(1) });
export type Creds = z.infer<typeof Schema>;

interface SecretsApi {
  get(k: string): Promise<string | undefined>;
  store(k: string, v: string): Promise<void>;
  delete(k: string): Promise<void>;
}

const KEY = 'ldap';

export class CredsStore {
  constructor(private secrets: SecretsApi) {}

  async load(): Promise<Creds | undefined> {
    const raw = await this.secrets.get(KEY);
    if (!raw) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return undefined; }
    const r = Schema.safeParse(parsed);
    return r.success ? r.data : undefined;
  }

  async save(c: Creds): Promise<void> {
    Schema.parse(c);
    await this.secrets.store(KEY, JSON.stringify(c));
  }

  async clear(): Promise<void> {
    await this.secrets.delete(KEY);
  }
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- credsStore`
Expected: 5 pass.

---

### Task 16: `NewRequestForm` component

**Files:**
- Create: `plugin-packages/datafleet/src/ui/NewRequestForm.tsx`
- Create: `plugin-packages/datafleet/src/__tests__/NewRequestForm.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewRequestForm } from '../ui/NewRequestForm';

describe('NewRequestForm', () => {
  it('disables submit until required fields are filled', async () => {
    render(<NewRequestForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  it('submits with collected values', async () => {
    const onSubmit = vi.fn();
    render(<NewRequestForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/purpose/i), 'RM-Checkout');
    await userEvent.type(screen.getByLabelText(/linked ticket/i), 'MPMW-99');
    await userEvent.click(screen.getByLabelText('los'));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      purpose: 'RM-Checkout', linkedTicket: 'MPMW-99', mongoApps: ['los'],
    });
  });

  it('shows error from submitter', async () => {
    render(<NewRequestForm onSubmit={vi.fn()} onCancel={vi.fn()} error="LINKED TICKET NOT VALID" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/LINKED TICKET NOT VALID/);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm test -- NewRequestForm`
Expected: import error.

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import type { Purpose, MongoApp } from '../api/types';

const PURPOSES: Purpose[] = ['RM-Checkout', 'Tech-Support', 'Prod-Issue'];
const APPS: MongoApp[] = ['los', 'lms', 'eve', 'e2live', 'ffr'];

export interface NewRequestSubmit {
  purpose: Purpose;
  linkedTicket: string;
  mongoApps: MongoApp[];
}

export function NewRequestForm(props: {
  onSubmit: (v: NewRequestSubmit) => void;
  onCancel: () => void;
  error?: string;
}) {
  const [purpose, setPurpose] = useState<Purpose | ''>('');
  const [linkedTicket, setLinkedTicket] = useState('');
  const [apps, setApps] = useState<Set<MongoApp>>(new Set());

  const valid = purpose !== '' && linkedTicket.trim() !== '' && apps.size > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        props.onSubmit({
          purpose: purpose as Purpose,
          linkedTicket: linkedTicket.trim(),
          mongoApps: [...apps],
        });
      }}
    >
      {props.error && <p role="alert" style={{ color: 'red' }}>{props.error}</p>}

      <label>
        Purpose
        <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose | '')}>
          <option value="">— select —</option>
          {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>

      <label>
        Linked ticket
        <input value={linkedTicket} onChange={(e) => setLinkedTicket(e.target.value)} />
      </label>

      <fieldset>
        <legend>Mongo apps</legend>
        {APPS.map(a => (
          <label key={a}>
            <input
              type="checkbox"
              aria-label={a}
              checked={apps.has(a)}
              onChange={(e) => {
                const next = new Set(apps);
                if (e.target.checked) next.add(a); else next.delete(a);
                setApps(next);
              }}
            />
            {a}
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={!valid}>Submit</button>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </form>
  );
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- NewRequestForm`
Expected: 3 pass.

---

### Task 17: `AttachConnectionPicker` component

**Files:**
- Create: `plugin-packages/datafleet/src/ui/AttachConnectionPicker.tsx`
- Create: `plugin-packages/datafleet/src/__tests__/AttachConnectionPicker.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachConnectionPicker } from '../ui/AttachConnectionPicker';

const conns = [
  { id: '1', name: 'staging', host: 'h1', port: 27017, username: 'u' },
  { id: '2', name: 'prod',    host: 'h2', port: 27017, username: 'u' },
];

describe('AttachConnectionPicker', () => {
  it('renders the list from list()', async () => {
    render(<AttachConnectionPicker
      list={vi.fn(async () => conns)}
      attach={vi.fn()}
      password="secret"
      onDone={vi.fn()}
      onCancel={vi.fn()}
    />);
    await waitFor(() => screen.getByText('staging'));
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('prod')).toBeInTheDocument();
  });

  it('does not render the password in the DOM', async () => {
    render(<AttachConnectionPicker
      list={vi.fn(async () => conns)}
      attach={vi.fn()}
      password="topsecret123"
      onDone={vi.fn()}
      onCancel={vi.fn()}
    />);
    await waitFor(() => screen.getByText('staging'));
    expect(document.body.textContent).not.toContain('topsecret123');
  });

  it('confirms then calls attach with the chosen id and password', async () => {
    const attach = vi.fn();
    const onDone = vi.fn();
    render(<AttachConnectionPicker
      list={vi.fn(async () => conns)}
      attach={attach}
      password="pw"
      onDone={onDone}
      onCancel={vi.fn()}
    />);
    await waitFor(() => screen.getByText('staging'));
    await userEvent.click(screen.getByText('staging'));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(attach).toHaveBeenCalledWith('1', 'pw');
    expect(onDone).toHaveBeenCalled();
  });

  it('surfaces attach failures inline', async () => {
    const attach = vi.fn(async () => { throw new Error('Connection not found'); });
    render(<AttachConnectionPicker
      list={vi.fn(async () => conns)}
      attach={attach}
      password="pw"
      onDone={vi.fn()}
      onCancel={vi.fn()}
    />);
    await waitFor(() => screen.getByText('staging'));
    await userEvent.click(screen.getByText('staging'));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert')).toHaveTextContent(/Connection not found/);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm test -- AttachConnectionPicker`
Expected: import error.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from 'react';

interface ConnectionRef {
  id: string; name: string; host?: string; port?: number; username?: string;
}

export function AttachConnectionPicker(props: {
  list: () => Promise<ConnectionRef[]>;
  attach: (id: string, password: string) => Promise<void>;
  password: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [conns, setConns] = useState<ConnectionRef[]>([]);
  const [selected, setSelected] = useState<ConnectionRef | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    props.list()
      .then(cs => { if (!cancelled) setConns(cs); })
      .catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [props.list]);

  if (confirming && selected) {
    return (
      <div>
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        <p>
          Update password for <strong>{selected.name}</strong> ({selected.host}:{selected.port})?
          This cannot be undone.
        </p>
        <button onClick={async () => {
          setError(null);
          try {
            await props.attach(selected.id, props.password);
            props.onDone();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}>Confirm</button>
        <button onClick={() => { setConfirming(false); setError(null); }}>Back</button>
      </div>
    );
  }

  return (
    <div>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <ul>
        {conns.map(c => (
          <li key={c.id}>
            <button onClick={() => { setSelected(c); setConfirming(true); }}>
              {c.name} — {c.host}:{c.port} ({c.username ?? 'no user'})
            </button>
          </li>
        ))}
      </ul>
      <button onClick={props.onCancel}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- AttachConnectionPicker`
Expected: 4 pass.

---

### Task 18: `RequestsView` (composition + state machine)

**Files:**
- Create: `plugin-packages/datafleet/src/ui/RequestsView.tsx`
- Create: `plugin-packages/datafleet/src/__tests__/RequestsView.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestsView } from '../ui/RequestsView';
import type { PortalClient } from '../api/types';

function makeDeps(overrides: Partial<{
  portal: PortalClient;
  list: () => Promise<{ id: string; name: string; host?: string; port?: number; username?: string }[]>;
  attach: (id: string, pwd: string) => Promise<void>;
  loadCreds: () => Promise<{ username: string; password: string } | undefined>;
  saveCreds: (c: { username: string; password: string }) => Promise<void>;
  loadRequests: () => Promise<unknown[]>;
  addRequest: (r: unknown) => Promise<void>;
  updateStatus: (id: string, s: string) => Promise<void>;
}> = {}) {
  return {
    portal: {
      submitRequest: vi.fn(async () => ({ ok: true, jiraTicket: 'MPMW-77' })),
      fetchPassword: vi.fn(async () => ({ ok: true, password: 'pw' })),
    } as PortalClient,
    list: vi.fn(async () => [{ id: '1', name: 'staging', host: 'h', port: 27017, username: 'u' }]),
    attach: vi.fn(async () => {}),
    loadCreds: vi.fn(async () => ({ username: 'u', password: 'p' })),
    saveCreds: vi.fn(async () => {}),
    loadRequests: vi.fn(async () => []),
    addRequest: vi.fn(async () => {}),
    updateStatus: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('RequestsView', () => {
  it('submits a new request and shows it in the list', async () => {
    const deps = makeDeps();
    render(<RequestsView {...deps} />);
    await userEvent.click(await screen.findByRole('button', { name: /new request/i }));
    await userEvent.selectOptions(screen.getByLabelText(/purpose/i), 'RM-Checkout');
    await userEvent.type(screen.getByLabelText(/linked ticket/i), 'MPMW-1');
    await userEvent.click(screen.getByLabelText('los'));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => screen.getByText(/MPMW-77/));
    expect(deps.addRequest).toHaveBeenCalled();
  });

  it('fetches a password and shows Connect Password button', async () => {
    const deps = makeDeps({
      loadRequests: vi.fn(async () => [{
        id: 'MPMW-1', purpose: 'RM-Checkout', apps: ['los'],
        linkedTicket: 'MPMW-1', status: 'pending', createdAt: '2026-05-13T00:00:00Z',
      }]),
    });
    render(<RequestsView {...deps} />);
    await userEvent.click(await screen.findByText(/MPMW-1/));
    await userEvent.click(screen.getByRole('button', { name: /fetch password/i }));
    await waitFor(() => screen.getByRole('button', { name: /connect password/i }));
  });

  it('attaches password to selected connection and marks request used', async () => {
    const deps = makeDeps({
      loadRequests: vi.fn(async () => [{
        id: 'MPMW-1', purpose: 'RM-Checkout', apps: ['los'],
        linkedTicket: 'MPMW-1', status: 'pending', createdAt: '2026-05-13T00:00:00Z',
      }]),
    });
    render(<RequestsView {...deps} />);
    await userEvent.click(await screen.findByText(/MPMW-1/));
    await userEvent.click(screen.getByRole('button', { name: /fetch password/i }));
    await userEvent.click(await screen.findByRole('button', { name: /connect password/i }));
    await userEvent.click(await screen.findByText('staging'));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(deps.attach).toHaveBeenCalledWith('1', 'pw'));
    expect(deps.updateStatus).toHaveBeenCalledWith('MPMW-1', 'used');
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm test -- RequestsView`
Expected: import error.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState, useCallback } from 'react';
import type { PortalClient } from '../api/types';
import type { PersistedRequest, RequestStatus } from '../store/requestStore';
import { NewRequestForm } from './NewRequestForm';
import { AttachConnectionPicker } from './AttachConnectionPicker';

interface ConnectionRef {
  id: string; name: string; host?: string; port?: number; username?: string;
}
interface Creds { username: string; password: string }

interface RowState {
  password?: string;            // in-memory, never persisted
  status: RequestStatus;
}

export function RequestsView(props: {
  portal: PortalClient;
  list: () => Promise<ConnectionRef[]>;
  attach: (id: string, password: string) => Promise<void>;
  loadCreds: () => Promise<Creds | undefined>;
  saveCreds: (c: Creds) => Promise<void>;
  loadRequests: () => Promise<PersistedRequest[]>;
  addRequest: (r: PersistedRequest) => Promise<void>;
  updateStatus: (id: string, s: RequestStatus) => Promise<void>;
}) {
  const [requests, setRequests] = useState<PersistedRequest[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [credsPrompt, setCredsPrompt] = useState<((c: Creds) => void) | null>(null);

  useEffect(() => { props.loadRequests().then(setRequests); }, [props.loadRequests]);

  const ensureCreds = useCallback(async (): Promise<Creds> => {
    const existing = await props.loadCreds();
    if (existing) return existing;
    return new Promise<Creds>(resolve => {
      setCredsPrompt(() => async (c: Creds) => {
        await props.saveCreds(c);
        setCredsPrompt(null);
        resolve(c);
      });
    });
  }, [props]);

  const onSubmit = useCallback(async (v: { purpose: 'RM-Checkout' | 'Tech-Support' | 'Prod-Issue'; linkedTicket: string; mongoApps: ('los'|'lms'|'eve'|'e2live'|'ffr')[] }) => {
    setSubmitError(undefined);
    const creds = await ensureCreds();
    const res = await props.portal.submitRequest({ creds, ...v });
    if (!res.ok) { setSubmitError(res.reason); return; }
    const req: PersistedRequest = {
      id: res.jiraTicket, purpose: v.purpose, apps: v.mongoApps,
      linkedTicket: v.linkedTicket, status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await props.addRequest(req);
    setRequests(rs => [...rs, req]);
    setShowForm(false);
  }, [ensureCreds, props]);

  const fetchPassword = useCallback(async (id: string) => {
    const creds = await ensureCreds();
    const res = await props.portal.fetchPassword({ creds, reqId: id });
    if (res.ok) {
      setRowState(s => ({ ...s, [id]: { status: 'ready', password: res.password } }));
      return;
    }
    const terminalMap: Record<string, RequestStatus> = {
      REQ_REJECTED: 'rejected', REQ_EXPIRED: 'expired', ACCESS_EXISTS: 'already_exists',
    };
    const term = terminalMap[res.reason];
    if (term) {
      setRowState(s => ({ ...s, [id]: { status: term } }));
      await props.updateStatus(id, term);
    }
  }, [ensureCreds, props]);

  if (credsPrompt) return <CredsPrompt onSubmit={credsPrompt} />;
  if (showForm)    return <NewRequestForm onSubmit={onSubmit} onCancel={() => setShowForm(false)} error={submitError} />;
  if (showPicker && selectedId) {
    const pw = rowState[selectedId]?.password;
    if (!pw) { setShowPicker(false); return null; }
    return <AttachConnectionPicker
      list={props.list}
      attach={async (cid, password) => {
        await props.attach(cid, password);
        setRowState(s => ({ ...s, [selectedId]: { status: 'used' } }));
        await props.updateStatus(selectedId, 'used');
      }}
      password={pw}
      onDone={() => { setShowPicker(false); setSelectedId(null); }}
      onCancel={() => setShowPicker(false)}
    />;
  }

  return (
    <div>
      <button onClick={() => setShowForm(true)}>+ New Request</button>
      <ul>
        {requests.map(r => {
          const rs = rowState[r.id] ?? { status: r.status };
          return (
            <li key={r.id}>
              <button onClick={() => setSelectedId(r.id)}>{r.id} — {rs.status}</button>
              {selectedId === r.id && rs.status === 'pending' && (
                <button onClick={() => fetchPassword(r.id)}>Fetch Password</button>
              )}
              {selectedId === r.id && rs.status === 'ready' && (
                <button onClick={() => setShowPicker(true)}>Connect Password</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CredsPrompt(props: { onSubmit: (c: Creds) => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); props.onSubmit({ username: u, password: p }); }}>
      <label>LDAP username <input value={u} onChange={e => setU(e.target.value)} /></label>
      <label>LDAP password <input type="password" value={p} onChange={e => setP(e.target.value)} /></label>
      <button type="submit" disabled={!u || !p}>Save</button>
    </form>
  );
}
```

- [ ] **Step 4: Run — passes**

Run: `npm test -- RequestsView`
Expected: 3 pass.

---

### Task 19: `extension.ts` entry point

**Files:**
- Create: `plugin-packages/datafleet/src/extension.ts`

- [ ] **Step 1: Write the entry**

```ts
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { RequestsView } from './ui/RequestsView';
import { DataFleetClient } from './api/datafleetClient';
import { RequestStore } from './store/requestStore';
import { CredsStore } from './store/credsStore';

const PORTAL_URL = 'https://o7yd4zabrg.execute-api.ap-south-1.amazonaws.com/datafleet';

interface Mongolens {
  net:         { fetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }> };
  connections: { list(): Promise<{ id: string; name: string; host?: string; port?: number; username?: string }[]>;
                 updateCredentials(id: string, creds: { password: string }): Promise<void> };
  secrets:     { get(k: string): Promise<string | undefined>; store(k: string, v: string): Promise<void>; delete(k: string): Promise<void> };
  workspace:   { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void>; delete(k: string): Promise<void>; keys(): Promise<string[]> };
  views:       { register(v: { id: string; title: string; location: 'sidebar' | 'panel'; render(c: HTMLElement, ctx: unknown): { dispose(): void } }): { dispose(): void } };
  commands:    { register(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void } };
}

declare const mongolens: Mongolens;

export function activate() {
  const portal = new DataFleetClient({ fetch: mongolens.net.fetch.bind(mongolens.net), url: PORTAL_URL });
  const requests = new RequestStore(mongolens.workspace);
  const creds = new CredsStore(mongolens.secrets);

  const viewDisposable = mongolens.views.register({
    id: 'datafleet.requests',
    title: 'DataFleet',
    location: 'sidebar',
    render(container) {
      const root = createRoot(container);
      root.render(createElement(RequestsView, {
        portal,
        list:          () => mongolens.connections.list(),
        attach:        (id, password) => mongolens.connections.updateCredentials(id, { password }),
        loadCreds:     () => creds.load(),
        saveCreds:     (c) => creds.save(c),
        loadRequests:  () => requests.list(),
        addRequest:    (r) => requests.add(r),
        updateStatus:  (id, s) => requests.updateStatus(id, s),
      }));
      return { dispose() { root.unmount(); } };
    },
  });

  const cmd1 = mongolens.commands.register('datafleet.newRequest', () => {/* opened from view button */});
  const cmd2 = mongolens.commands.register('datafleet.fetchPassword', () => {/* opened from view button */});
  const cmd3 = mongolens.commands.register('datafleet.attachToConnection', () => {/* opened from view button */});

  return { dispose() { viewDisposable.dispose(); cmd1.dispose(); cmd2.dispose(); cmd3.dispose(); } };
}
```

- [ ] **Step 2: TS check**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Build the bundle**

Run: `npm run build`
Expected: emits `dist/extension.js`.

---

### Task 20: Manual smoke test

- [ ] **Step 1: Build host**

From the repo root: `npm run tauri dev` (or `npm run dev` if Tauri dev is heavy).

- [ ] **Step 2: Install the plugin**

In Mongo Lens: Settings → Plugins → **Install from folder** → select `plugin-packages/datafleet/`.

- [ ] **Step 3: Activate the view**

Open the DataFleet side panel. The view should render the empty request list and a **+ New Request** button.

- [ ] **Step 4: Live test (only when you have portal access)**

- Submit a request, enter LDAP creds when prompted, observe the new row in the list.
- Wait for portal approval out of band.
- Click the row → Fetch Password → observe the **Connect Password** button.
- Click Connect Password → pick a connection → Confirm → verify the connection's password now works for a real query in the existing connection tree.

- [ ] **Step 5: Note expected limitations**

- Requests will disappear on app restart (in-memory `WorkspaceStore`).
- LDAP creds will be re-prompted after restart (in-memory `SecretStorage`).
- Both go away when the Keychain backend lands (Part 2 backlog of the plugin system).

---

## Self-review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| §1 Goal | Implicit across all tasks |
| §2 Scope (in) | Tasks 12–19 (full lifecycle, saved history, secrets) and Task 4 (updateCredentials) |
| §2 Scope (out) | Not implemented — confirmed by absence of auto-renew, postgres, password persistence |
| §3 Architecture | Task split: Part A = host, Part B = plugin folder |
| §4.1 `ConnectionsApi` | Task 2 (types), Task 4 (impl), Task 7 (tests) |
| §4.2 `connections:write` scope | Task 1 |
| §4.3 createMongolens wiring | Task 6 |
| §4.4 Audit logging | Task 4 (`audit?.(...)`), Task 7 (assertion) |
| §5.1 Folder layout | Task 10 |
| §5.2 `PortalClient` interface | Task 12 |
| §5.3 Manifest | Task 11 |
| §5.4 Persisted state (`requests`, `ldap`) | Tasks 14, 15 |
| §6.1 SR flow | Task 18 (test #1) |
| §6.2 GP flow | Task 18 (test #2), Task 13 (every status enum) |
| §6.3 Attach flow | Task 18 (test #3), Task 17 |
| §7 Error handling | Task 13 (PortalNetworkError), Task 17 (inline alert), Task 14 (corrupt entries), Task 15 (malformed JSON) |
| §8 Testing | Each implementation task pairs with a test task |
| §9 File map | Tasks 1–9 (Part A), Tasks 10–19 (Part B) |
| §10 Risks | Not code; called out in spec |
| §11 Out-of-spec | Acknowledged in Task 20 Step 5 |

No gaps.

**Type/name consistency check:**

- `ConnectionRef` shape identical across Task 2, Task 4, Task 7, Task 17.
- `PortalClient` / `SubmitRequestArgs` / `FetchPasswordArgs` defined in Task 12, used unchanged in Tasks 13, 18, 19.
- `PersistedRequest` defined in Task 14, used unchanged in Task 18.
- `Creds` type defined in Task 15, used unchanged in Task 18.
- `connections:write` scope literal matches between permission test (Task 1), host service (Task 4), and manifest (Task 11).
- `mongolens.net.fetch`, `mongolens.connections.*`, `mongolens.secrets.*`, `mongolens.workspace.*` signatures consistent between host service (Task 4), createMongolens (Task 6), and plugin (Tasks 13–19).

**Placeholder scan:** no TBDs, no "handle errors", no "similar to Task N". Each step has either explicit code or a runnable command.
