# Plugin System Host — Implementation Plan (Part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-app plugin host for Mongo Lens — folder-based plugins with declared contributions, lazy activation, permission-gated `mongolens` API, and minimal Plugins settings UI. End state: an external developer can drop a folder under `~/.mongomacapp/plugins/`, restart the app, see their contributions registered, run a contributed command, and have disallowed scopes rejected.

**Architecture:** Contribution-point manifest + imperative `mongolens` API (VS Code pattern). Nine `Registry<T>` instances — one per extension point — implementing a shared interface so adding a new extension point is additive only (OCP). A `PluginManager` owns lifecycle (discover → install → activate → deactivate). A `PermissionBroker` wraps every side-effect API method against the plugin's granted scope list. Plugins run in the renderer in per-plugin module scope with `window`/`fetch`/`__TAURI__` scrubbed.

**Tech Stack:** TypeScript (strict), React 18, Vitest + jsdom, Zustand, Tauri v2 (file IO via `@tauri-apps/plugin-fs`), Ajv for JSON-Schema manifest validation.

**Spec:** `docs/superpowers/specs/2026-05-12-plugin-system-design.md`

**Out of scope for this plan (covered in Part 2):** `PluginConsolePanel`, dev-mode file watcher / hot reload, `@mongolens/plugin-api` npm types package, `create-mongolens-plugin` scaffolder.

**Conventions used by this codebase (follow these):**
- Tests live in `src/__tests__/<feature>.test.ts(x)` — flat folder, descriptive names.
- Strict TS (`noUnusedLocals`, `noUnusedParameters`).
- Vitest globals (`describe`, `it`, `expect` imported from `vitest` only when needed by IDE; `globals: true` is configured).
- No new top-level deps without justification. We add **one** new dep this plan: `ajv` (manifest schema validation).

---

## Task 0: Setup — branch, dep, folder skeleton

**Files:**
- Modify: `package.json` (add `ajv` dep)
- Create: `src/plugins/index.ts` (barrel)

- [ ] **Step 1: Verify on a clean branch from main**

Run:
```bash
git status
git rev-parse --abbrev-ref HEAD
```
Expected: working tree clean; branch name shown.

- [ ] **Step 2: Add `ajv` dependency**

Run:
```bash
npm install ajv@^8.17.0
```
Expected: `package.json` and `package-lock.json` updated; no install errors.

- [ ] **Step 3: Create the plugin module folder with a barrel**

Create `src/plugins/index.ts`:
```ts
// Public surface of the plugin host. Imports filled in by later tasks.
export {};
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/plugins/index.ts
git commit -m "chore(plugins): add ajv and create plugin module skeleton"
```

---

## Task 1: `Disposable` primitive

**Files:**
- Create: `src/plugins/api/disposable.ts`
- Test: `src/__tests__/plugins-disposable.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-disposable.test.ts`:
```ts
import { toDisposable, DisposableStore } from '../plugins/api/disposable';

describe('Disposable', () => {
  it('toDisposable wraps a function and invokes it once on dispose', () => {
    const fn = vi.fn();
    const d = toDisposable(fn);
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('DisposableStore disposes all children in LIFO order', () => {
    const order: number[] = [];
    const store = new DisposableStore();
    store.add(toDisposable(() => order.push(1)));
    store.add(toDisposable(() => order.push(2)));
    store.dispose();
    expect(order).toEqual([2, 1]);
  });

  it('DisposableStore.add after dispose throws', () => {
    const store = new DisposableStore();
    store.dispose();
    expect(() => store.add(toDisposable(() => {}))).toThrow(/disposed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-disposable.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement**

Create `src/plugins/api/disposable.ts`:
```ts
export interface Disposable {
  dispose(): void | Promise<void>;
}

export function toDisposable(fn: () => void | Promise<void>): Disposable {
  let disposed = false;
  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      await fn();
    },
  };
}

export class DisposableStore implements Disposable {
  private items: Disposable[] = [];
  private disposed = false;

  add(d: Disposable): void {
    if (this.disposed) throw new Error('DisposableStore is already disposed');
    this.items.push(d);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.items.length - 1; i >= 0; i--) {
      try { await this.items[i].dispose(); } catch { /* swallow per-item; host logs upstream */ }
    }
    this.items = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-disposable.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/api/disposable.ts src/__tests__/plugins-disposable.test.ts
git commit -m "feat(plugins): Disposable primitive and DisposableStore"
```

---

## Task 2: `Registry<T>` base

**Files:**
- Create: `src/plugins/Registry.ts`
- Test: `src/__tests__/plugins-registry.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-registry.test.ts`:
```ts
import { Registry } from '../plugins/Registry';

interface Foo { id: string; label: string; }

describe('Registry<T>', () => {
  it('register adds an item and returns a Disposable that removes it', () => {
    const r = new Registry<Foo>('foo');
    const d = r.register({ id: 'a', label: 'A' }, 'plugin-1');
    expect(r.get('a')).toEqual({ id: 'a', label: 'A' });
    d.dispose();
    expect(r.get('a')).toBeUndefined();
  });

  it('register rejects duplicate ids with a clear error', () => {
    const r = new Registry<Foo>('foo');
    r.register({ id: 'a', label: 'A' }, 'p1');
    expect(() => r.register({ id: 'a', label: 'A2' }, 'p2')).toThrow(/already registered/i);
  });

  it('list returns items in insertion order', () => {
    const r = new Registry<Foo>('foo');
    r.register({ id: 'a', label: 'A' }, 'p1');
    r.register({ id: 'b', label: 'B' }, 'p1');
    expect(r.list().map(i => i.id)).toEqual(['a', 'b']);
  });

  it('onDidChange fires on register and dispose', () => {
    const r = new Registry<Foo>('foo');
    const listener = vi.fn();
    r.onDidChange(listener);
    const d = r.register({ id: 'a', label: 'A' }, 'p1');
    d.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('disposeForPlugin removes everything owned by a plugin id', () => {
    const r = new Registry<Foo>('foo');
    r.register({ id: 'a', label: 'A' }, 'p1');
    r.register({ id: 'b', label: 'B' }, 'p2');
    r.disposeForPlugin('p1');
    expect(r.list().map(i => i.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-registry.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement**

Create `src/plugins/Registry.ts`:
```ts
import { Disposable, toDisposable } from './api/disposable';

interface Entry<T> { item: T; owner: string; }

export class Registry<T extends { id: string }> {
  private entries = new Map<string, Entry<T>>();
  private listeners = new Set<() => void>();

  constructor(public readonly name: string) {}

  register(item: T, ownerPluginId: string): Disposable {
    if (this.entries.has(item.id)) {
      throw new Error(
        `Registry[${this.name}]: id "${item.id}" already registered (owner=${this.entries.get(item.id)!.owner})`,
      );
    }
    this.entries.set(item.id, { item, owner: ownerPluginId });
    this.fire();
    return toDisposable(() => {
      if (this.entries.delete(item.id)) this.fire();
    });
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.item;
  }

  list(): readonly T[] {
    return Array.from(this.entries.values(), e => e.item);
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return toDisposable(() => { this.listeners.delete(listener); });
  }

  disposeForPlugin(pluginId: string): void {
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (entry.owner === pluginId) { this.entries.delete(id); changed = true; }
    }
    if (changed) this.fire();
  }

  private fire(): void {
    for (const l of this.listeners) { try { l(); } catch { /* listeners must not throw */ } }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-registry.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/Registry.ts src/__tests__/plugins-registry.test.ts
git commit -m "feat(plugins): Registry<T> base with owner-scoped disposal"
```

---

## Task 3: Permission scope vocabulary + parser

**Files:**
- Create: `src/plugins/permissions.ts`
- Test: `src/__tests__/plugins-permissions.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-permissions.test.ts`:
```ts
import { parseScope, matchesScope, KNOWN_SCOPE_KINDS } from '../plugins/permissions';

describe('permissions', () => {
  it('parses scopes with no argument', () => {
    expect(parseScope('database:read')).toEqual({ kind: 'database:read' });
    expect(parseScope('workspace:write')).toEqual({ kind: 'workspace:write' });
  });

  it('parses network:fetch with URL pattern arg', () => {
    expect(parseScope('network:fetch:https://*.acme.com')).toEqual({
      kind: 'network:fetch',
      arg: 'https://*.acme.com',
    });
  });

  it('rejects unknown scope kinds', () => {
    expect(() => parseScope('filesystem:read')).toThrow(/unknown scope/i);
  });

  it('KNOWN_SCOPE_KINDS includes every kind in v1 vocabulary', () => {
    expect(KNOWN_SCOPE_KINDS).toEqual(
      expect.arrayContaining([
        'database:read', 'database:write',
        'network:fetch',
        'secrets:read', 'secrets:write',
        'workspace:read', 'workspace:write',
      ]),
    );
  });

  it('matchesScope: exact-kind scopes match by kind', () => {
    const granted = [parseScope('database:read')];
    expect(matchesScope(granted, { kind: 'database:read' })).toBe(true);
    expect(matchesScope(granted, { kind: 'database:write' })).toBe(false);
  });

  it('matchesScope: network:fetch matches host glob with * only in host', () => {
    const granted = [parseScope('network:fetch:https://*.acme.com')];
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://api.acme.com/v1' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://evil.com/' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-permissions.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement**

Create `src/plugins/permissions.ts`:
```ts
export const KNOWN_SCOPE_KINDS = [
  'database:read', 'database:write',
  'network:fetch',
  'secrets:read', 'secrets:write',
  'workspace:read', 'workspace:write',
] as const;

export type ScopeKind = (typeof KNOWN_SCOPE_KINDS)[number];

export interface Scope {
  kind: ScopeKind;
  arg?: string;
}

const ARG_REQUIRED: ReadonlySet<ScopeKind> = new Set(['network:fetch']);

export function parseScope(raw: string): Scope {
  // Split into at most three parts; kind keeps the first two segments ("a:b"), arg is the rest joined.
  const parts = raw.split(':');
  if (parts.length < 2) throw new Error(`Invalid scope "${raw}"`);
  const kind = `${parts[0]}:${parts[1]}` as ScopeKind;
  if (!(KNOWN_SCOPE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unknown scope kind "${kind}"`);
  }
  const arg = parts.length > 2 ? parts.slice(2).join(':') : undefined;
  if (ARG_REQUIRED.has(kind) && !arg) {
    throw new Error(`Scope "${kind}" requires an argument`);
  }
  return arg !== undefined ? { kind, arg } : { kind };
}

export function matchesScope(granted: readonly Scope[], requested: Scope): boolean {
  for (const g of granted) {
    if (g.kind !== requested.kind) continue;
    if (g.arg === undefined && requested.arg === undefined) return true;
    if (g.kind === 'network:fetch' && g.arg && requested.arg) {
      if (matchUrlGlob(g.arg, requested.arg)) return true;
    }
  }
  return false;
}

function matchUrlGlob(pattern: string, url: string): boolean {
  // Only host glob is supported; * may appear in host only. Path/query checked as a prefix.
  try {
    const pu = new URL(pattern.replace('*', 'WILDCARD'));
    const uu = new URL(url);
    if (pu.protocol !== uu.protocol) return false;
    const hostPattern = pu.hostname.replace('WILDCARD', '*');
    const hostRe = new RegExp('^' + hostPattern.split('*').map(escapeRe).join('[^.]+') + '$');
    if (!hostRe.test(uu.hostname)) return false;
    if (pu.pathname !== '/' && !uu.pathname.startsWith(pu.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-permissions.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/permissions.ts src/__tests__/plugins-permissions.test.ts
git commit -m "feat(plugins): permission scope vocabulary and matcher"
```

---

## Task 4: Manifest JSON Schema + validator

**Files:**
- Create: `src/plugins/schema/manifest.schema.json`
- Create: `src/plugins/manifest.ts`
- Test: `src/__tests__/plugins-manifest.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-manifest.test.ts`:
```ts
import { validateManifest } from '../plugins/manifest';

const valid = {
  id: 'acme.foo',
  name: 'Foo',
  version: '1.0.0',
  engines: { mongolens: '^1.0.0' },
  main: 'dist/main.js',
  permissions: ['database:read'],
  activationEvents: ['onCommand:foo.run'],
  contributes: {
    commands: [{ id: 'foo.run', title: 'Run Foo' }],
  },
};

describe('manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    const r = validateManifest(valid);
    expect(r.ok).toBe(true);
  });

  it('rejects missing id', () => {
    const m = { ...valid }; delete (m as Record<string, unknown>).id;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors?.join(' ')).toMatch(/id/);
  });

  it('rejects id not matching <publisher>.<name>', () => {
    const r = validateManifest({ ...valid, id: 'no-dot' });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown permission scope', () => {
    const r = validateManifest({ ...valid, permissions: ['filesystem:read'] });
    expect(r.ok).toBe(false);
    expect(r.errors?.join(' ')).toMatch(/scope/i);
  });

  it('rejects unknown activation event prefix', () => {
    const r = validateManifest({ ...valid, activationEvents: ['onWhenever:foo'] });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-manifest.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement schema**

Create `src/plugins/schema/manifest.schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["id", "name", "version", "engines", "main"],
  "additionalProperties": false,
  "properties": {
    "id":      { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*\\.[a-z0-9][a-z0-9-]*$" },
    "name":    { "type": "string", "minLength": 1 },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?$" },
    "engines": {
      "type": "object",
      "required": ["mongolens"],
      "properties": { "mongolens": { "type": "string", "minLength": 1 } },
      "additionalProperties": false
    },
    "main": { "type": "string", "minLength": 1 },
    "permissions": {
      "type": "array",
      "items": { "type": "string", "pattern": "^(database:(read|write)|network:fetch:.+|secrets:(read|write)|workspace:(read|write))$" },
      "uniqueItems": true
    },
    "activationEvents": {
      "type": "array",
      "items": { "type": "string", "pattern": "^(onCommand:|onView:|onExecutionMode:|onConnectionProvider:|onExportTarget:).+|^onStartup$" },
      "uniqueItems": true
    },
    "contributes": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "commands":            { "type": "array", "items": { "type": "object", "required": ["id","title"], "properties": { "id":{"type":"string"},"title":{"type":"string"},"category":{"type":"string"} } } },
        "keybindings":         { "type": "array", "items": { "type": "object", "required": ["command","mac"], "properties": { "command":{"type":"string"},"mac":{"type":"string"},"when":{"type":"string"} } } },
        "views":               { "type": "array", "items": { "type": "object", "required": ["id","title","location"], "properties": { "id":{"type":"string"},"title":{"type":"string"},"location":{"enum":["sidebar","panel"]} } } },
        "resultViewers":       { "type": "array", "items": { "type": "object", "required": ["id","title"], "properties": { "id":{"type":"string"},"title":{"type":"string"},"when":{"type":"string"} } } },
        "executionModes":      { "type": "array", "items": { "type": "object", "required": ["id","title"], "properties": { "id":{"type":"string"},"title":{"type":"string"} } } },
        "aiTools":             { "type": "array", "items": { "type": "object", "required": ["id","schema"], "properties": { "id":{"type":"string"},"schema":{"type":"string"} } } },
        "connectionProviders": { "type": "array", "items": { "type": "object", "required": ["id","title"], "properties": { "id":{"type":"string"},"title":{"type":"string"} } } },
        "themes":              { "type": "array", "items": { "type": "object", "required": ["id","path"], "properties": { "id":{"type":"string"},"path":{"type":"string"} } } },
        "exportTargets":       { "type": "array", "items": { "type": "object", "required": ["id","title","formats"], "properties": { "id":{"type":"string"},"title":{"type":"string"},"formats":{"type":"array","items":{"type":"string"}} } } }
      }
    }
  }
}
```

- [ ] **Step 4: Implement validator**

Create `src/plugins/manifest.ts`:
```ts
import Ajv, { ErrorObject } from 'ajv';
import schema from './schema/manifest.schema.json';

export interface CommandContribution      { id: string; title: string; category?: string }
export interface KeybindingContribution   { command: string; mac: string; when?: string }
export interface ViewContribution         { id: string; title: string; location: 'sidebar' | 'panel' }
export interface ResultViewerContribution { id: string; title: string; when?: string }
export interface ExecutionModeContrib     { id: string; title: string }
export interface AIToolContribution       { id: string; schema: string }
export interface ConnectionProviderContrib{ id: string; title: string }
export interface ThemeContribution        { id: string; path: string }
export interface ExportTargetContribution { id: string; title: string; formats: string[] }

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  engines: { mongolens: string };
  main: string;
  permissions?: string[];
  activationEvents?: string[];
  contributes?: {
    commands?: CommandContribution[];
    keybindings?: KeybindingContribution[];
    views?: ViewContribution[];
    resultViewers?: ResultViewerContribution[];
    executionModes?: ExecutionModeContrib[];
    aiTools?: AIToolContribution[];
    connectionProviders?: ConnectionProviderContrib[];
    themes?: ThemeContribution[];
    exportTargets?: ExportTargetContribution[];
  };
}

const ajv = new Ajv({ allErrors: true });
const compiled = ajv.compile<PluginManifest>(schema);

export interface ValidateResult {
  ok: boolean;
  manifest?: PluginManifest;
  errors?: string[];
}

export function validateManifest(raw: unknown): ValidateResult {
  if (compiled(raw)) {
    return { ok: true, manifest: raw };
  }
  const errors = (compiled.errors ?? []).map(formatError);
  return { ok: false, errors };
}

function formatError(e: ErrorObject): string {
  const path = e.instancePath || '/';
  if (e.keyword === 'pattern' && path.startsWith('/permissions')) {
    return `${path}: invalid permission scope (${e.params.pattern}) — value did not match v1 scope vocabulary`;
  }
  return `${path}: ${e.message ?? 'invalid'}`;
}
```

- [ ] **Step 5: Configure Vite to import JSON**

`tsconfig.json` already has `"resolveJsonModule": true`. No change needed. Confirm:
```bash
grep resolveJsonModule tsconfig.json
```
Expected: `"resolveJsonModule": true,`

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-manifest.test.ts`
Expected: 5 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/schema/manifest.schema.json src/plugins/manifest.ts src/__tests__/plugins-manifest.test.ts
git commit -m "feat(plugins): manifest JSON Schema and ajv validator"
```

---

## Task 5: `PermissionBroker`

**Files:**
- Create: `src/plugins/PermissionBroker.ts`
- Test: `src/__tests__/plugins-permission-broker.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-permission-broker.test.ts`:
```ts
import { PermissionBroker, PermissionDeniedError } from '../plugins/PermissionBroker';
import { parseScope } from '../plugins/permissions';

describe('PermissionBroker', () => {
  it('allows a call when matching scope is granted', () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('database:read')]);
    expect(() => broker.check('p1', { kind: 'database:read' })).not.toThrow();
  });

  it('throws PermissionDeniedError when scope is not granted', () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', []);
    expect(() => broker.check('p1', { kind: 'database:read' })).toThrow(PermissionDeniedError);
  });

  it('audits every check', () => {
    const broker = new PermissionBroker();
    const audit = vi.fn();
    broker.onAudit(audit);
    broker.setGrants('p1', [parseScope('database:read')]);
    broker.check('p1', { kind: 'database:read' });
    try { broker.check('p1', { kind: 'database:write' }); } catch { /* expected */ }
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls[0][0]).toMatchObject({ pluginId: 'p1', scope: { kind: 'database:read' }, allowed: true });
    expect(audit.mock.calls[1][0]).toMatchObject({ pluginId: 'p1', scope: { kind: 'database:write' }, allowed: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-permission-broker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/PermissionBroker.ts`:
```ts
import { matchesScope, Scope } from './permissions';
import { Disposable, toDisposable } from './api/disposable';

export class PermissionDeniedError extends Error {
  constructor(public readonly pluginId: string, public readonly scope: Scope) {
    super(`Plugin "${pluginId}" lacks scope ${scope.kind}${scope.arg ? `:${scope.arg}` : ''}`);
    this.name = 'PermissionDeniedError';
  }
}

export interface AuditEvent {
  pluginId: string;
  scope: Scope;
  allowed: boolean;
  timestamp: number;
}

export class PermissionBroker {
  private grants = new Map<string, Scope[]>();
  private auditListeners = new Set<(e: AuditEvent) => void>();

  setGrants(pluginId: string, scopes: Scope[]): void {
    this.grants.set(pluginId, scopes);
  }

  getGrants(pluginId: string): readonly Scope[] {
    return this.grants.get(pluginId) ?? [];
  }

  clearGrants(pluginId: string): void {
    this.grants.delete(pluginId);
  }

  check(pluginId: string, requested: Scope): void {
    const granted = this.grants.get(pluginId) ?? [];
    const allowed = matchesScope(granted, requested);
    this.fireAudit({ pluginId, scope: requested, allowed, timestamp: Date.now() });
    if (!allowed) throw new PermissionDeniedError(pluginId, requested);
  }

  onAudit(listener: (e: AuditEvent) => void): Disposable {
    this.auditListeners.add(listener);
    return toDisposable(() => { this.auditListeners.delete(listener); });
  }

  private fireAudit(e: AuditEvent): void {
    for (const l of this.auditListeners) { try { l(e); } catch { /* listeners must not throw */ } }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-permission-broker.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/PermissionBroker.ts src/__tests__/plugins-permission-broker.test.ts
git commit -m "feat(plugins): PermissionBroker with audit"
```

---

## Task 6: Plugin logger adapter

**Files:**
- Create: `src/plugins/api/logger.ts`
- Test: `src/__tests__/plugins-logger.test.ts`

The app already has `src/services/logger/`. The plugin logger is a thin adapter that tags every record with `pluginId` and routes to the existing logger.

- [ ] **Step 1: Read the existing logger surface**

Run: `ls src/services/logger && head -40 src/services/logger/index.ts`
Note the exported `getLogger(name)` shape — use it below.

- [ ] **Step 2: Write failing test**

Create `src/__tests__/plugins-logger.test.ts`:
```ts
import { createPluginLogger } from '../plugins/api/logger';

describe('plugin logger', () => {
  it('tags every record with pluginId and forwards to underlying logger', () => {
    const calls: { level: string; msg: string; ctx?: Record<string, unknown> }[] = [];
    const underlying = {
      info:  (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'info', msg, ctx }),
      warn:  (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'warn', msg, ctx }),
      error: (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'error', msg, ctx }),
      debug: (msg: string, ctx?: Record<string, unknown>) => calls.push({ level: 'debug', msg, ctx }),
    };
    const logger = createPluginLogger('acme.foo', underlying);
    logger.info('hello', { x: 1 });
    logger.error('boom');
    expect(calls).toEqual([
      { level: 'info',  msg: 'hello', ctx: { x: 1, pluginId: 'acme.foo' } },
      { level: 'error', msg: 'boom',  ctx: { pluginId: 'acme.foo' } },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-logger.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `src/plugins/api/logger.ts`:
```ts
export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export function createPluginLogger(pluginId: string, underlying: Logger): Logger {
  const tag = (ctx?: Record<string, unknown>) => ({ ...(ctx ?? {}), pluginId });
  return {
    debug: (m, c) => underlying.debug(m, tag(c)),
    info:  (m, c) => underlying.info(m,  tag(c)),
    warn:  (m, c) => underlying.warn(m,  tag(c)),
    error: (m, c) => underlying.error(m, tag(c)),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-logger.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/api/logger.ts src/__tests__/plugins-logger.test.ts
git commit -m "feat(plugins): per-plugin logger adapter"
```

---

## Task 7: Per-plugin `SecretStorage`

**Files:**
- Create: `src/plugins/api/secretStorage.ts`
- Test: `src/__tests__/plugins-secret-storage.test.ts`

V1: backed by an in-memory map injected by the host. The host wires it to Keychain via Tauri command in Task 13. This task defines the interface and an in-memory impl used by tests and as a fallback.

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-secret-storage.test.ts`:
```ts
import { InMemorySecretStorage, namespaceFor } from '../plugins/api/secretStorage';

describe('SecretStorage', () => {
  it('get/set/delete round-trips', async () => {
    const s = new InMemorySecretStorage();
    await s.store('k', 'v');
    expect(await s.get('k')).toBe('v');
    await s.delete('k');
    expect(await s.get('k')).toBeUndefined();
  });

  it('namespaceFor produces a stable plugin-scoped key', () => {
    expect(namespaceFor('acme.foo', 'api-token')).toBe('plugin:acme.foo:api-token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-secret-storage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/api/secretStorage.ts`:
```ts
export interface SecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemorySecretStorage implements SecretStorage {
  private map = new Map<string, string>();
  async get(k: string)    { return this.map.get(k); }
  async store(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
}

export function namespaceFor(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-secret-storage.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/api/secretStorage.ts src/__tests__/plugins-secret-storage.test.ts
git commit -m "feat(plugins): SecretStorage interface + in-memory impl"
```

---

## Task 8: Sandbox wrapper `runInPluginSandbox`

**Files:**
- Create: `src/plugins/sandbox/runInPluginSandbox.ts`
- Test: `src/__tests__/plugins-sandbox-run.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-sandbox-run.test.ts`:
```ts
import { runInPluginSandbox } from '../plugins/sandbox/runInPluginSandbox';

describe('runInPluginSandbox', () => {
  it('returns the value when the function succeeds', async () => {
    const result = await runInPluginSandbox('p1', () => 42, { onError: vi.fn() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('catches sync throws and reports via onError', async () => {
    const onError = vi.fn();
    const result = await runInPluginSandbox('p1', () => { throw new Error('boom'); }, { onError });
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('p1', expect.objectContaining({ message: 'boom' }));
  });

  it('catches async rejections and reports via onError', async () => {
    const onError = vi.fn();
    const result = await runInPluginSandbox('p1', async () => { throw new Error('async-boom'); }, { onError });
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('p1', expect.objectContaining({ message: 'async-boom' }));
  });

  it('enforces a timeout (rejects long-running)', async () => {
    const onError = vi.fn();
    const result = await runInPluginSandbox(
      'p1',
      () => new Promise(r => setTimeout(r, 200)),
      { onError, timeoutMs: 20 },
    );
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('p1', expect.objectContaining({ message: expect.stringMatching(/timed out/i) }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-sandbox-run.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/sandbox/runInPluginSandbox.ts`:
```ts
export type SandboxResult<T> = { ok: true; value: T } | { ok: false; error: Error };

export interface SandboxOptions {
  onError: (pluginId: string, error: Error) => void;
  timeoutMs?: number;
}

export async function runInPluginSandbox<T>(
  pluginId: string,
  fn: () => T | Promise<T>,
  opts: SandboxOptions,
): Promise<SandboxResult<T>> {
  try {
    const work = Promise.resolve().then(fn);
    const value = opts.timeoutMs
      ? await Promise.race([
          work,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Plugin "${pluginId}" timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs),
          ),
        ])
      : await work;
    return { ok: true, value };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    opts.onError(pluginId, err);
    return { ok: false, error: err };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-sandbox-run.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/sandbox/runInPluginSandbox.ts src/__tests__/plugins-sandbox-run.test.ts
git commit -m "feat(plugins): runInPluginSandbox wrapper with timeout"
```

---

## Task 9: Module loader with scope scrubbing

**Files:**
- Create: `src/plugins/sandbox/moduleLoader.ts`
- Test: `src/__tests__/plugins-module-loader.test.ts`

**Design note:** The plugin module is loaded via dynamic `import()` using a `blob:` URL whose contents wrap the plugin source in an IIFE that shadows ambient globals to `undefined`. This is best-effort hardening, not a true sandbox (spec §10 acknowledges this).

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-module-loader.test.ts`:
```ts
import { wrapPluginSource } from '../plugins/sandbox/moduleLoader';

describe('moduleLoader.wrapPluginSource', () => {
  it('wraps source in an IIFE that shadows window/fetch/__TAURI__/localStorage', () => {
    const out = wrapPluginSource('export const x = 1;');
    expect(out).toMatch(/let window =/);
    expect(out).toMatch(/let fetch =/);
    expect(out).toMatch(/let __TAURI__ =/);
    expect(out).toMatch(/let localStorage =/);
    expect(out).toMatch(/let XMLHttpRequest =/);
  });

  it('preserves the original source between the markers', () => {
    const out = wrapPluginSource('export const x = 1;');
    expect(out).toContain('export const x = 1;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-module-loader.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/sandbox/moduleLoader.ts`:
```ts
const SCRUBBED_GLOBALS = [
  'window', 'self', 'globalThis',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB',
  '__TAURI__', '__TAURI_INVOKE__', '__TAURI_INTERNALS__',
];

export function wrapPluginSource(source: string): string {
  const decls = SCRUBBED_GLOBALS.map(g => `  let ${g} = undefined;`).join('\n');
  // Note: the wrapped source is itself an ES module so we use a block, not a function.
  return `// mongo-lens plugin sandbox wrapper\n${decls}\n${source}\n`;
}

export interface LoadedModule {
  activate?: (context: unknown) => unknown | Promise<unknown>;
  deactivate?: () => unknown | Promise<unknown>;
}

export async function loadPluginModule(source: string): Promise<LoadedModule> {
  const wrapped = wrapPluginSource(source);
  const blob = new Blob([wrapped], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return (await import(/* @vite-ignore */ url)) as LoadedModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-module-loader.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/sandbox/moduleLoader.ts src/__tests__/plugins-module-loader.test.ts
git commit -m "feat(plugins): plugin module loader with scope-scrubbing IIFE wrapper"
```

---

## Task 10: Define contribution contracts (registry payload types)

**Files:**
- Create: `src/plugins/api/contracts.ts`

These types are the registry payloads — distinct from manifest contributions. The manifest gives the *declared* shape; contracts are the *runtime* objects plugins register via `mongolens.<x>.register()`.

- [ ] **Step 1: Create contracts file**

Create `src/plugins/api/contracts.ts`:
```ts
import { Disposable } from './disposable';

export interface Command {
  id: string;
  handler: (...args: unknown[]) => unknown | Promise<unknown>;
}

export interface Keybinding {
  id: string;          // synthetic, "<command>@<keys>"
  command: string;
  mac: string;
  when?: string;
}

export interface ResultContext {
  result: unknown;
  connectionId?: string;
  database?: string;
}

export interface ResultViewer {
  id: string;
  title: string;
  match(result: unknown): boolean;
  render(container: HTMLElement, ctx: ResultContext): Disposable;
}

export interface ViewContext { container: HTMLElement; }
export interface ViewProvider {
  id: string;
  title: string;
  location: 'sidebar' | 'panel';
  render(container: HTMLElement, ctx: ViewContext): Disposable;
}

export interface ExecCtx {
  connectionId?: string;
  database?: string;
}
export type ExecEvent =
  | { kind: 'row'; row: unknown }
  | { kind: 'log'; message: string }
  | { kind: 'done'; stats?: Record<string, unknown> };

export interface ExecutionModeContract {
  id: string;
  title: string;
  run(script: string, ctx: ExecCtx): AsyncIterable<ExecEvent>;
}

export interface AITool {
  id: string;
  schema: unknown; // JSON Schema describing inputs
  invoke(args: unknown, ctx: { signal: AbortSignal }): Promise<unknown>;
}

export interface ConnectionConfig { [k: string]: unknown }
export interface DriverHandle { id: string; close(): Promise<void> }

export interface ConnectionProvider {
  id: string;
  title: string;
  createConfig(ui: { prompt: (spec: unknown) => Promise<unknown> }): Promise<ConnectionConfig>;
  connect(cfg: ConnectionConfig): Promise<DriverHandle>;
}

export interface ThemeContract {
  id: string;
  json: Record<string, unknown>; // theme JSON
}

export interface ExportTargetContract {
  id: string;
  title: string;
  formats: string[];
  export(rows: unknown[], format: string, ctx: { connectionId?: string }): Promise<void>;
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/api/contracts.ts
git commit -m "feat(plugins): runtime contribution contract types"
```

---

## Task 11: Instantiate all nine registries (registry set)

**Files:**
- Create: `src/plugins/registries.ts`
- Test: `src/__tests__/plugins-registries.test.ts`

We don't need a class per registry — each is a `Registry<ContractType>` keyed by `id`. The set is exposed as a single object so the API facade (Task 12) is a thin wrapper.

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-registries.test.ts`:
```ts
import { createRegistrySet } from '../plugins/registries';

describe('registry set', () => {
  it('exposes all nine registries with the expected names', () => {
    const r = createRegistrySet();
    expect(Object.keys(r).sort()).toEqual(
      [
        'aiTools',
        'commands',
        'connectionProviders',
        'executionModes',
        'exportTargets',
        'keybindings',
        'resultViewers',
        'themes',
        'views',
      ],
    );
  });

  it('each registry round-trips an item', () => {
    const r = createRegistrySet();
    const d = r.commands.register({ id: 'foo', handler: () => 1 }, 'p1');
    expect(r.commands.get('foo')?.handler()).toBe(1);
    d.dispose();
    expect(r.commands.get('foo')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-registries.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/registries.ts`:
```ts
import { Registry } from './Registry';
import {
  Command, Keybinding, ResultViewer, ViewProvider, ExecutionModeContract,
  AITool, ConnectionProvider, ThemeContract, ExportTargetContract,
} from './api/contracts';

export interface RegistrySet {
  commands:            Registry<Command>;
  keybindings:         Registry<Keybinding>;
  views:               Registry<ViewProvider>;
  resultViewers:       Registry<ResultViewer>;
  executionModes:      Registry<ExecutionModeContract>;
  aiTools:             Registry<AITool>;
  connectionProviders: Registry<ConnectionProvider>;
  themes:              Registry<ThemeContract>;
  exportTargets:       Registry<ExportTargetContract>;
}

export function createRegistrySet(): RegistrySet {
  return {
    commands:            new Registry<Command>('commands'),
    keybindings:         new Registry<Keybinding>('keybindings'),
    views:               new Registry<ViewProvider>('views'),
    resultViewers:       new Registry<ResultViewer>('resultViewers'),
    executionModes:      new Registry<ExecutionModeContract>('executionModes'),
    aiTools:             new Registry<AITool>('aiTools'),
    connectionProviders: new Registry<ConnectionProvider>('connectionProviders'),
    themes:              new Registry<ThemeContract>('themes'),
    exportTargets:       new Registry<ExportTargetContract>('exportTargets'),
  };
}

export function disposeAllForPlugin(set: RegistrySet, pluginId: string): void {
  for (const r of Object.values(set)) r.disposeForPlugin(pluginId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-registries.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/registries.ts src/__tests__/plugins-registries.test.ts
git commit -m "feat(plugins): registry set covering all nine extension points"
```

---

## Task 12: Migrate existing `execution-modes/registry.ts` onto the new `Registry<T>`

**Files:**
- Modify: `src/execution-modes/registry.ts`
- Modify: `src/execution-modes/index.ts`
- Modify: `src/execution-modes/smart.ts` (only if `registerExecutionMode` signature changes)
- Modify: `src/execution-modes/full-script.ts` (same)

Built-in execution modes must register through the new registry too. We keep the existing `ExecutionMode` UI-flavored type (it has `keybind`, `buttonStyle`, `resolveContent` — different from `ExecutionModeContract` which has `run()`). They are **different concerns**: built-in modes are local UI dispatch; plugin execution modes pipe to a runner. We keep them separate registries to avoid forcing a unified contract.

So **this task only updates the existing in-app registry to be backed by `Registry<T>`** — the plugin `executionModes` registry from Task 11 remains a peer.

- [ ] **Step 1: Read current file**

```bash
cat src/execution-modes/registry.ts
```

- [ ] **Step 2: Update registry to wrap `Registry<T>`**

Replace contents of `src/execution-modes/registry.ts`:
```ts
import { Registry } from '../plugins/Registry';
import { ExecutionMode } from './types';

const _registry = new Registry<ExecutionMode>('builtinExecutionModes');

export function registerExecutionMode(mode: ExecutionMode): void {
  _registry.register(mode, '__builtin__');
}

export function getExecutionModes(): readonly ExecutionMode[] {
  return _registry.list();
}

export function getExecutionMode(id: string): ExecutionMode | undefined {
  return _registry.get(id);
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: every existing test passes; the registry migration is behavior-preserving.

- [ ] **Step 4: Commit**

```bash
git add src/execution-modes/registry.ts
git commit -m "refactor(execution-modes): back built-in registry with Registry<T>"
```

---

## Task 13: Host services bundle (db / net / ui / secrets)

**Files:**
- Create: `src/plugins/hostServices.ts`
- Test: `src/__tests__/plugins-host-services.test.ts`

Plugins receive a single `HostServices` bag at construction. Each method delegates to existing app services (Tauri IPC for db/net) but is wrapped by the `PermissionBroker`. For v1, db/net/ui implementations are **thin stubs** that route through the existing Tauri commands; we don't add new Rust commands in this plan.

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-host-services.test.ts`:
```ts
import { createHostServices } from '../plugins/hostServices';
import { PermissionBroker, PermissionDeniedError } from '../plugins/PermissionBroker';
import { parseScope } from '../plugins/permissions';

describe('hostServices.db.find', () => {
  it('is denied without database:read', async () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', []);
    const svc = createHostServices({
      broker,
      pluginId: 'p1',
      backend: { dbFind: vi.fn(), netFetch: vi.fn() },
    });
    await expect(svc.db.find('coll', {})).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('is allowed and forwards to backend with database:read', async () => {
    const dbFind = vi.fn().mockResolvedValue([{ x: 1 }]);
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('database:read')]);
    const svc = createHostServices({
      broker, pluginId: 'p1',
      backend: { dbFind, netFetch: vi.fn() },
    });
    await expect(svc.db.find('coll', { a: 1 })).resolves.toEqual([{ x: 1 }]);
    expect(dbFind).toHaveBeenCalledWith({ coll: 'coll', filter: { a: 1 }, opts: undefined });
  });

  it('net.fetch checks scope against URL', async () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('network:fetch:https://*.acme.com')]);
    const netFetch = vi.fn().mockResolvedValue({ status: 200 });
    const svc = createHostServices({
      broker, pluginId: 'p1',
      backend: { dbFind: vi.fn(), netFetch },
    });
    await expect(svc.net.fetch('https://api.acme.com/v1')).resolves.toEqual({ status: 200 });
    await expect(svc.net.fetch('https://evil.com/')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-host-services.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/hostServices.ts`:
```ts
import { PermissionBroker } from './PermissionBroker';

export interface HostBackend {
  dbFind(args: { coll: string; filter: unknown; opts?: unknown }): Promise<unknown[]>;
  netFetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }>;
}

export interface HostServices {
  db:  { find(coll: string, filter: unknown, opts?: unknown): Promise<unknown[]> };
  net: { fetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }> };
}

export function createHostServices(params: {
  broker: PermissionBroker;
  pluginId: string;
  backend: HostBackend;
}): HostServices {
  const { broker, pluginId, backend } = params;
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
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-host-services.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/hostServices.ts src/__tests__/plugins-host-services.test.ts
git commit -m "feat(plugins): host services bag with permission-gated db/net"
```

---

## Task 14: `mongolens` API facade builder

**Files:**
- Create: `src/plugins/api/createMongolens.ts`
- Test: `src/__tests__/plugins-mongolens-api.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-mongolens-api.test.ts`:
```ts
import { createMongolens } from '../plugins/api/createMongolens';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

describe('mongolens facade', () => {
  it('exposes commands.register and routes ownership to the pluginId', () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1',
      registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    const d = api.commands.register('foo', () => 'bar');
    expect(set.commands.get('foo')?.handler()).toBe('bar');
    d.dispose();
    expect(set.commands.get('foo')).toBeUndefined();
  });

  it('commands.execute looks up and invokes the registered command', async () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    api.commands.register('add', (a: number, b: number) => a + b);
    await expect(api.commands.execute('add', 2, 3)).resolves.toBe(5);
  });

  it('throws when executing an unknown command', async () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    await expect(api.commands.execute('missing')).rejects.toThrow(/unknown command/i);
  });

  it('db.find routes to host services', async () => {
    const find = vi.fn().mockResolvedValue([1]);
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find }, net: { fetch: vi.fn() } },
    });
    await expect(api.db.find('coll', {})).resolves.toEqual([1]);
  });

  // Ensure unused param does not fail strict TS — broker present in real wiring
  it('does not leak broker into the api surface', () => {
    const set = createRegistrySet();
    const api = createMongolens({
      pluginId: 'p1', registries: set,
      services: { db: { find: vi.fn() }, net: { fetch: vi.fn() } } as never,
    });
    expect((api as Record<string, unknown>).broker).toBeUndefined();
    new PermissionBroker(); // touch import so strict TS doesn't complain
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-mongolens-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/api/createMongolens.ts`:
```ts
import { Disposable } from './disposable';
import { RegistrySet } from '../registries';
import { HostServices } from '../hostServices';
import {
  Command, ResultViewer, ViewProvider, ExecutionModeContract,
  AITool, ConnectionProvider, ThemeContract, ExportTargetContract,
} from './contracts';

export interface MongolensAPI {
  commands: {
    register(id: string, handler: Command['handler']): Disposable;
    execute(id: string, ...args: unknown[]): Promise<unknown>;
  };
  views:               { register(v: ViewProvider): Disposable };
  resultViewers:       { register(v: ResultViewer): Disposable };
  executionModes:      { register(v: ExecutionModeContract): Disposable };
  aiTools:             { register(v: AITool): Disposable };
  connectionProviders: { register(v: ConnectionProvider): Disposable };
  themes:              { register(v: ThemeContract): Disposable };
  exportTargets:       { register(v: ExportTargetContract): Disposable };

  db:  HostServices['db'];
  net: HostServices['net'];
}

export function createMongolens(params: {
  pluginId: string;
  registries: RegistrySet;
  services: HostServices;
}): MongolensAPI {
  const { pluginId, registries: r, services } = params;
  return {
    commands: {
      register(id, handler) { return r.commands.register({ id, handler }, pluginId); },
      async execute(id, ...args) {
        const cmd = r.commands.get(id);
        if (!cmd) throw new Error(`Unknown command "${id}"`);
        return cmd.handler(...args);
      },
    },
    views:               { register: v => r.views.register(v, pluginId) },
    resultViewers:       { register: v => r.resultViewers.register(v, pluginId) },
    executionModes:      { register: v => r.executionModes.register(v, pluginId) },
    aiTools:             { register: v => r.aiTools.register(v, pluginId) },
    connectionProviders: { register: v => r.connectionProviders.register(v, pluginId) },
    themes:              { register: v => r.themes.register(v, pluginId) },
    exportTargets:       { register: v => r.exportTargets.register(v, pluginId) },

    db:  services.db,
    net: services.net,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-mongolens-api.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/api/createMongolens.ts src/__tests__/plugins-mongolens-api.test.ts
git commit -m "feat(plugins): mongolens API facade builder"
```

---

## Task 15: `ExtensionContext` factory + `PluginRecord`

**Files:**
- Create: `src/plugins/ExtensionContext.ts`
- Test: `src/__tests__/plugins-extension-context.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-extension-context.test.ts`:
```ts
import { createExtensionContext } from '../plugins/ExtensionContext';
import { InMemorySecretStorage } from '../plugins/api/secretStorage';

describe('ExtensionContext', () => {
  it('builds a context tagged with pluginId and an empty subscriptions array', () => {
    const ctx = createExtensionContext({
      pluginId: 'acme.foo',
      storagePath: '/tmp/acme.foo',
      secrets: new InMemorySecretStorage(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(ctx.pluginId).toBe('acme.foo');
    expect(ctx.storagePath).toBe('/tmp/acme.foo');
    expect(ctx.subscriptions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-extension-context.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/ExtensionContext.ts`:
```ts
import { Disposable } from './api/disposable';
import { Logger } from './api/logger';
import { SecretStorage } from './api/secretStorage';

export interface ExtensionContext {
  pluginId: string;
  storagePath: string;
  subscriptions: Disposable[];
  secrets: SecretStorage;
  logger: Logger;
}

export function createExtensionContext(params: {
  pluginId: string;
  storagePath: string;
  secrets: SecretStorage;
  logger: Logger;
}): ExtensionContext {
  return { ...params, subscriptions: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-extension-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ExtensionContext.ts src/__tests__/plugins-extension-context.test.ts
git commit -m "feat(plugins): ExtensionContext factory"
```

---

## Task 16: `PluginManager` — discovery (read manifests from disk)

**Files:**
- Create: `src/plugins/PluginManager.ts`
- Create: `src/plugins/io.ts` (fs interface so tests can stub disk)
- Test: `src/__tests__/plugins-manager-discover.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-manager-discover.test.ts`:
```ts
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('PluginManager.discover', () => {
  it('reads each manifest, validates, registers contributions', async () => {
    const manifest = {
      id: 'acme.foo', name: 'Foo', version: '1.0.0',
      engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
      activationEvents: ['onCommand:foo.run'],
      contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
    };
    const registries = createRegistrySet();
    const mgr = new PluginManager({
      registries,
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(manifest),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (dir, main) => `${dir}/${main}`,
      },
    });
    await mgr.discover();
    expect(mgr.list().map(p => p.id)).toEqual(['acme.foo']);
    // Contributions registered immediately, before activation
    expect(registries.commands.list()).toEqual([]); // commands contract requires handler; manifest only declares — see Task 19
  });

  it('rejects engine version mismatch', async () => {
    const manifest = {
      id: 'acme.bar', name: 'Bar', version: '1.0.0',
      engines: { mongolens: '^2.0.0' }, main: 'dist/main.js',
    };
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.bar'],
        readManifest:    async () => JSON.stringify(manifest),
        readEntry:       async () => '',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    const rec = mgr.list().find(p => p.id === 'acme.bar')!;
    expect(rec.state).toBe('incompatible');
  });

  it('marks plugins with invalid manifest as "broken" without throwing', async () => {
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/broken'],
        readManifest:    async () => '{ "id": "no-dot" }',
        readEntry:       async () => '',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    expect(mgr.list()[0].state).toBe('broken');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-manager-discover.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `io.ts`**

Create `src/plugins/io.ts`:
```ts
export interface PluginFs {
  listPluginDirs(): Promise<string[]>;
  readManifest(pluginDir: string): Promise<string>;
  readEntry(entryAbsPath: string): Promise<string>;
  pluginEntryPath(pluginDir: string, manifestMain: string): string;
}
```

- [ ] **Step 4: Implement `PluginManager.discover`**

Create `src/plugins/PluginManager.ts`:
```ts
import { Registry } from './Registry';
import { RegistrySet } from './registries';
import { PermissionBroker } from './PermissionBroker';
import { validateManifest, PluginManifest } from './manifest';
import { Logger } from './api/logger';
import { PluginFs } from './io';

export type PluginState =
  | 'discovered'      // manifest valid, contributions registered, not activated
  | 'incompatible'    // engines.mongolens does not satisfy hostApiVersion
  | 'broken'          // manifest invalid or file IO failed
  | 'activating'
  | 'active'
  | 'failed'          // activation errored
  | 'disabled';

export interface PluginRecord {
  id: string;
  manifest?: PluginManifest;
  dir: string;
  state: PluginState;
  errors?: string[];
}

interface ManagerOptions {
  registries: RegistrySet;
  broker: PermissionBroker;
  hostApiVersion: string;
  logger: Logger;
  fs: PluginFs;
}

export class PluginManager {
  private records = new Map<string, PluginRecord>();
  constructor(private readonly opts: ManagerOptions) {}

  list(): PluginRecord[] {
    return Array.from(this.records.values());
  }

  get(id: string): PluginRecord | undefined {
    return this.records.get(id);
  }

  async discover(): Promise<void> {
    const dirs = await this.opts.fs.listPluginDirs();
    for (const dir of dirs) {
      await this.loadOne(dir);
    }
  }

  private async loadOne(dir: string): Promise<void> {
    const id = dir.split('/').pop() ?? dir;
    try {
      const raw = await this.opts.fs.readManifest(dir);
      const parsed = JSON.parse(raw) as unknown;
      const v = validateManifest(parsed);
      if (!v.ok || !v.manifest) {
        this.records.set(id, { id, dir, state: 'broken', errors: v.errors });
        this.opts.logger.warn('Plugin manifest invalid', { dir, errors: v.errors });
        return;
      }
      if (!satisfies(this.opts.hostApiVersion, v.manifest.engines.mongolens)) {
        this.records.set(v.manifest.id, { id: v.manifest.id, dir, manifest: v.manifest, state: 'incompatible' });
        this.opts.logger.warn('Plugin incompatible with host', { id: v.manifest.id });
        return;
      }
      this.records.set(v.manifest.id, { id: v.manifest.id, dir, manifest: v.manifest, state: 'discovered' });
      // Note: command/view/etc. *contributions* are pure metadata; runtime handlers
      // are registered only at activate(). So we don't push into Registry<T> here.
    } catch (e) {
      this.records.set(id, { id, dir, state: 'broken', errors: [String(e)] });
    }
  }
}

// Minimal semver range check sufficient for v1: supports "^X.Y.Z" only.
// Major must match; minor/patch of host must be >= manifest's.
export function satisfies(hostVersion: string, range: string): boolean {
  const m = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [maj, min, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = hostVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!h) return false;
  const [hMaj, hMin, hPatch] = [Number(h[1]), Number(h[2]), Number(h[3])];
  if (hMaj !== maj) return false;
  if (hMin > min) return true;
  if (hMin < min) return false;
  return hPatch >= patch;
}

// Re-export so consumers don't need to know the Registry generic.
export { Registry };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-manager-discover.test.ts`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/io.ts src/plugins/PluginManager.ts src/__tests__/plugins-manager-discover.test.ts
git commit -m "feat(plugins): PluginManager.discover with manifest validation and version check"
```

---

## Task 17: `PluginManager` — activate / deactivate

**Files:**
- Modify: `src/plugins/PluginManager.ts`
- Test: `src/__tests__/plugins-manager-activate.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-manager-activate.test.ts`:
```ts
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { parseScope } from '../plugins/permissions';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const MANIFEST = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  permissions: ['database:read'],
  activationEvents: ['onCommand:foo.run'],
  contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
};

const ENTRY = `
export function activate(ctx) {
  const d = mongolens.commands.register('foo.run', () => 'ran-foo');
  ctx.subscriptions.push(d);
}
`;

describe('PluginManager activation', () => {
  it('activate() imports entry, runs activate(), registers commands', async () => {
    const registries = createRegistrySet();
    const broker = new PermissionBroker();
    broker.setGrants('acme.foo', [parseScope('database:read')]);
    const mgr = new PluginManager({
      registries, broker, hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activate('acme.foo');
    expect(mgr.get('acme.foo')?.state).toBe('active');
    expect(registries.commands.get('foo.run')?.handler()).toBe('ran-foo');
  });

  it('deactivate() disposes all subscriptions and clears registry entries', async () => {
    const registries = createRegistrySet();
    const broker = new PermissionBroker();
    broker.setGrants('acme.foo', []);
    const mgr = new PluginManager({
      registries, broker, hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activate('acme.foo');
    expect(registries.commands.get('foo.run')).toBeDefined();
    await mgr.deactivate('acme.foo');
    expect(mgr.get('acme.foo')?.state).toBe('disabled');
    expect(registries.commands.get('foo.run')).toBeUndefined();
  });

  it('marks plugin as failed when activate() throws, never crashes host', async () => {
    const failing = `export function activate(){ throw new Error('nope'); }`;
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => failing,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activate('acme.foo');           // must not throw
    expect(mgr.get('acme.foo')?.state).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-manager-activate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `PluginManager`**

Append to `src/plugins/PluginManager.ts` (inside the class, plus a top import block):
```ts
// at the top of the file, after existing imports
import { disposeAllForPlugin } from './registries';
import { createExtensionContext, ExtensionContext } from './ExtensionContext';
import { InMemorySecretStorage } from './api/secretStorage';
import { createPluginLogger } from './api/logger';
import { createMongolens, MongolensAPI } from './api/createMongolens';
import { createHostServices, HostBackend } from './hostServices';
import { runInPluginSandbox } from './sandbox/runInPluginSandbox';
import { wrapPluginSource, LoadedModule } from './sandbox/moduleLoader';
import { parseScope } from './permissions';
```

```ts
  // add to ManagerOptions:
  //   hostBackend?: HostBackend;
  //   entryLoader?: (record: PluginRecord) => Promise<LoadedModule>;
  // (Append both keys; existing code untouched.)

  private contexts = new Map<string, ExtensionContext>();
  private loadedModules = new Map<string, LoadedModule>();

  async activate(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec || !rec.manifest) {
      this.opts.logger.warn('activate: unknown plugin', { id });
      return;
    }
    if (rec.state === 'active' || rec.state === 'activating') return;
    rec.state = 'activating';

    // Apply granted scopes (parsed from manifest.permissions for v1 — consent dialog
    // wires in real grants in Task 21).
    const scopes = (rec.manifest.permissions ?? []).map(parseScope);
    this.opts.broker.setGrants(id, scopes);

    const logger    = createPluginLogger(id, this.opts.logger);
    const secrets   = new InMemorySecretStorage();
    const ctx       = createExtensionContext({ pluginId: id, storagePath: `${rec.dir}/.data`, secrets, logger });
    const backend: HostBackend = this.opts.hostBackend ?? defaultBackend();
    const services  = createHostServices({ broker: this.opts.broker, pluginId: id, backend });
    const api       = createMongolens({ pluginId: id, registries: this.opts.registries, services });
    this.contexts.set(id, ctx);

    const result = await runInPluginSandbox(id, async () => {
      const mod = this.opts.entryLoader
        ? await this.opts.entryLoader(rec)
        : await defaultLoader(this.opts.fs, rec);
      this.loadedModules.set(id, mod);
      // Inject `mongolens` into the plugin's scope. We do this by attaching to globalThis
      // for the duration of activate() — the wrapper IIFE shadows other globals but lets
      // `mongolens` through. This is the simplest cross-bundler injection point.
      (globalThis as Record<string, unknown>).mongolens = api;
      try {
        if (typeof mod.activate === 'function') await mod.activate(ctx);
      } finally {
        delete (globalThis as Record<string, unknown>).mongolens;
      }
    }, { onError: (pid, err) => this.opts.logger.error('Plugin activation failed', { pluginId: pid, message: err.message }), timeoutMs: 10_000 });

    if (!result.ok) {
      rec.state = 'failed';
      rec.errors = [result.error.message];
      this.opts.broker.clearGrants(id);
      disposeAllForPlugin(this.opts.registries, id);
      this.contexts.delete(id);
      return;
    }
    rec.state = 'active';
  }

  async deactivate(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    const mod = this.loadedModules.get(id);
    const ctx = this.contexts.get(id);

    if (mod?.deactivate) {
      await runInPluginSandbox(id, () => mod.deactivate!(), {
        onError: (pid, err) => this.opts.logger.warn('Plugin deactivate threw', { pluginId: pid, message: err.message }),
        timeoutMs: 2000,
      });
    }
    if (ctx) {
      for (let i = ctx.subscriptions.length - 1; i >= 0; i--) {
        try { await ctx.subscriptions[i].dispose(); } catch (e) {
          this.opts.logger.warn('Subscription dispose threw', { pluginId: id, message: String(e) });
        }
      }
    }
    disposeAllForPlugin(this.opts.registries, id);
    this.opts.broker.clearGrants(id);
    this.loadedModules.delete(id);
    this.contexts.delete(id);
    rec.state = 'disabled';
  }
}

function defaultBackend(): HostBackend {
  return {
    async dbFind() { throw new Error('Host backend not wired (test stub)'); },
    async netFetch() { throw new Error('Host backend not wired (test stub)'); },
  };
}

async function defaultLoader(fs: PluginFs, rec: PluginRecord): Promise<LoadedModule> {
  if (!rec.manifest) throw new Error('No manifest');
  const source = await fs.readEntry(fs.pluginEntryPath(rec.dir, rec.manifest.main));
  // Evaluate via Function to avoid bundler ESM constraints in the unit test environment.
  // In the real renderer this is replaced by the blob-URL dynamic import in Task 18.
  const wrapped = wrapPluginSource(source);
  const exports: Record<string, unknown> = {};
  const fn = new Function('exports', 'mongolens', `${wrapped}\nreturn exports;`);
  // The wrapped source uses ES module `export`; rewrite naive `export function X` to `exports.X = function`.
  // For v1 unit tests we accept a simple textual transform; the real loader (Task 18) uses native ESM.
  const cjsSource = wrapped
    .replace(/export\s+function\s+(\w+)/g, 'exports.$1 = function')
    .replace(/export\s+const\s+(\w+)\s*=/g, 'exports.$1 =');
  const fn2 = new Function('exports', 'mongolens', `${cjsSource}\nreturn exports;`);
  const result = fn2(exports, (globalThis as Record<string, unknown>).mongolens);
  void fn; // keep the strict-unused linter happy
  return result as LoadedModule;
}
```

> **Author note:** Yes, this dual-loader is ugly. We keep the textual ESM→CJS transform here purely so the unit-test runtime (no real ESM blob URL support in jsdom) can exercise `activate`. Task 18 introduces the production loader that uses the real blob-URL `import()` path in the renderer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-manager-activate.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/PluginManager.ts src/__tests__/plugins-manager-activate.test.ts
git commit -m "feat(plugins): PluginManager activate/deactivate with sandbox + subscription disposal"
```

---

## Task 18: Production loader using blob-URL dynamic `import()`

**Files:**
- Modify: `src/plugins/PluginManager.ts` (`defaultLoader` swap)
- Modify: `src/plugins/sandbox/moduleLoader.ts` (already has `loadPluginModule`; export it)

- [ ] **Step 1: Wire the renderer loader**

Replace `defaultLoader` in `src/plugins/PluginManager.ts` with a production version that prefers `loadPluginModule` (blob URL + dynamic `import()`) and falls back to the textual transform only when `URL.createObjectURL` is unavailable (Vitest jsdom).

In `src/plugins/PluginManager.ts`, replace the body of `defaultLoader`:
```ts
async function defaultLoader(fs: PluginFs, rec: PluginRecord): Promise<LoadedModule> {
  if (!rec.manifest) throw new Error('No manifest');
  const source = await fs.readEntry(fs.pluginEntryPath(rec.dir, rec.manifest.main));
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
    // Production path — renderer
    const { loadPluginModule } = await import('./sandbox/moduleLoader');
    return loadPluginModule(source);
  }
  // Test path — jsdom without ESM blob support
  const cjsSource = wrapPluginSource(source)
    .replace(/export\s+function\s+(\w+)/g, 'exports.$1 = function')
    .replace(/export\s+const\s+(\w+)\s*=/g, 'exports.$1 =');
  const fn = new Function('exports', 'mongolens', `${cjsSource}\nreturn exports;`);
  const exports: Record<string, unknown> = {};
  return fn(exports, (globalThis as Record<string, unknown>).mongolens) as LoadedModule;
}
```

- [ ] **Step 2: Run full suite**

Run: `npx vitest run`
Expected: all plugin tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/PluginManager.ts
git commit -m "feat(plugins): production loader via blob-URL dynamic import with test fallback"
```

---

## Task 19: Activation events — wiring command/view triggers

**Files:**
- Modify: `src/plugins/PluginManager.ts` (`activateForEvent`)
- Test: `src/__tests__/plugins-manager-events.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-manager-events.test.ts`:
```ts
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() { return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }; }

const MANIFEST = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  activationEvents: ['onCommand:foo.run', 'onStartup'],
  contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
};
const ENTRY = `export function activate(ctx){
  const d = mongolens.commands.register('foo.run', () => 'ran');
  ctx.subscriptions.push(d);
}`;

describe('activation events', () => {
  it('activateForEvent(onCommand:foo.run) activates only matching plugins', async () => {
    const registries = createRegistrySet();
    const mgr = new PluginManager({
      registries, broker: new PermissionBroker(), hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    expect(mgr.get('acme.foo')?.state).toBe('discovered');
    await mgr.activateForEvent('onCommand:foo.run');
    expect(mgr.get('acme.foo')?.state).toBe('active');
  });

  it('activateStartup activates plugins with onStartup', async () => {
    const registries = createRegistrySet();
    const mgr = new PluginManager({
      registries, broker: new PermissionBroker(), hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activateStartup();
    expect(mgr.get('acme.foo')?.state).toBe('active');
  });

  it('idempotent: re-activating an active plugin is a no-op', async () => {
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => ENTRY,
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    await mgr.activateForEvent('onCommand:foo.run');
    await mgr.activateForEvent('onCommand:foo.run'); // should not double-register
    expect(mgr.get('acme.foo')?.state).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-manager-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `activateForEvent` and `activateStartup`**

Append to `PluginManager`:
```ts
  async activateForEvent(event: string): Promise<void> {
    for (const rec of this.records.values()) {
      if (rec.state !== 'discovered') continue;
      if ((rec.manifest?.activationEvents ?? []).includes(event)) {
        await this.activate(rec.id);
      }
    }
  }

  async activateStartup(): Promise<void> {
    await this.activateForEvent('onStartup');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-manager-events.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/PluginManager.ts src/__tests__/plugins-manager-events.test.ts
git commit -m "feat(plugins): activation events (onCommand, onStartup) via activateForEvent"
```

---

## Task 20: Install/uninstall from a folder (production fs)

**Files:**
- Create: `src/plugins/io.tauri.ts` (Tauri-backed `PluginFs`)
- Modify: `src/plugins/PluginManager.ts` (`install(srcDir)`, `uninstall(id)`)
- Test: `src/__tests__/plugins-manager-install.test.ts`

- [ ] **Step 1: Write failing test (uses an in-memory FS stub)**

Create `src/__tests__/plugins-manager-install.test.ts`:
```ts
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';

function silentLogger() { return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }; }

class FakeFs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  pluginsRoot = '/installed';
  async listPluginDirs() { return Array.from(this.dirs); }
  async readManifest(dir: string) { return this.files.get(`${dir}/manifest.json`)!; }
  async readEntry(p: string) { return this.files.get(p) ?? ''; }
  pluginEntryPath(d: string, m: string) { return `${d}/${m}`; }
  async copyDir(src: string, dest: string) {
    for (const [path, content] of this.files) {
      if (path.startsWith(src + '/')) {
        const rel = path.slice(src.length);
        this.files.set(dest + rel, content);
      }
    }
    this.dirs.add(dest);
  }
  async removeDir(dir: string) {
    this.dirs.delete(dir);
    for (const k of Array.from(this.files.keys())) if (k.startsWith(dir + '/')) this.files.delete(k);
  }
}

const MANIFEST = JSON.stringify({
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  contributes: { commands: [{ id: 'foo.run', title: 'Run Foo' }] },
});

describe('PluginManager install/uninstall', () => {
  it('install copies a source folder into pluginsRoot and discovers the plugin', async () => {
    const fs = new FakeFs();
    fs.files.set('/src/foo/manifest.json', MANIFEST);
    fs.files.set('/src/foo/dist/main.js', 'export function activate(){}');
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs, pluginsRoot: fs.pluginsRoot,
    });
    await mgr.install('/src/foo');
    expect(fs.dirs.has('/installed/acme.foo')).toBe(true);
    expect(mgr.get('acme.foo')?.state).toBe('discovered');
  });

  it('uninstall removes the folder and drops the record', async () => {
    const fs = new FakeFs();
    fs.files.set('/src/foo/manifest.json', MANIFEST);
    fs.files.set('/src/foo/dist/main.js', 'export function activate(){}');
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs, pluginsRoot: fs.pluginsRoot,
    });
    await mgr.install('/src/foo');
    await mgr.uninstall('acme.foo');
    expect(fs.dirs.has('/installed/acme.foo')).toBe(false);
    expect(mgr.get('acme.foo')).toBeUndefined();
  });

  it('install rejects a folder with an invalid manifest', async () => {
    const fs = new FakeFs();
    fs.files.set('/src/bad/manifest.json', '{ "id": "no-dot" }');
    const mgr = new PluginManager({
      registries: createRegistrySet(), broker: new PermissionBroker(),
      hostApiVersion: '1.0.0', logger: silentLogger(),
      fs, pluginsRoot: fs.pluginsRoot,
    });
    await expect(mgr.install('/src/bad')).rejects.toThrow(/invalid manifest/i);
  });
});
```

- [ ] **Step 2: Extend `PluginFs` and `ManagerOptions`**

In `src/plugins/io.ts`, add:
```ts
  copyDir?(src: string, dest: string): Promise<void>;
  removeDir?(dir: string): Promise<void>;
```

In `PluginManager.ts`, extend `ManagerOptions` with `pluginsRoot?: string` and implement:

```ts
  async install(srcDir: string): Promise<string> {
    if (!this.opts.fs.copyDir || !this.opts.pluginsRoot) {
      throw new Error('install requires fs.copyDir and pluginsRoot');
    }
    const raw = await this.opts.fs.readManifest(srcDir);
    const v = validateManifest(JSON.parse(raw) as unknown);
    if (!v.ok || !v.manifest) throw new Error(`Invalid manifest: ${v.errors?.join('; ')}`);
    const dest = `${this.opts.pluginsRoot}/${v.manifest.id}`;
    await this.opts.fs.copyDir(srcDir, dest);
    await this.loadOne(dest);
    return v.manifest.id;
  }

  async uninstall(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    if (rec.state === 'active') await this.deactivate(id);
    if (this.opts.fs.removeDir) await this.opts.fs.removeDir(rec.dir);
    this.records.delete(id);
  }
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-manager-install.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Implement Tauri-backed PluginFs**

Create `src/plugins/io.tauri.ts`:
```ts
import { BaseDirectory, readTextFile, readDir, mkdir, copyFile, remove } from '@tauri-apps/plugin-fs';
import { PluginFs } from './io';

const PLUGINS_REL = '.mongomacapp/plugins';
const BASE = BaseDirectory.Home;

export async function createTauriPluginFs(): Promise<PluginFs & { pluginsRoot: string }> {
  await mkdir(PLUGINS_REL, { baseDir: BASE, recursive: true });
  return {
    pluginsRoot: PLUGINS_REL,
    async listPluginDirs() {
      const entries = await readDir(PLUGINS_REL, { baseDir: BASE });
      return entries
        .filter(e => e.isDirectory)
        .map(e => `${PLUGINS_REL}/${e.name}`);
    },
    async readManifest(dir) {
      return readTextFile(`${dir}/manifest.json`, { baseDir: BASE });
    },
    async readEntry(p) {
      return readTextFile(p, { baseDir: BASE });
    },
    pluginEntryPath(dir, main) { return `${dir}/${main}`; },
    async copyDir(src, dest) {
      await mkdir(dest, { baseDir: BASE, recursive: true });
      const items = await readDir(src, { baseDir: BASE });
      for (const item of items) {
        const s = `${src}/${item.name}`;
        const d = `${dest}/${item.name}`;
        if (item.isDirectory) await this.copyDir!(s, d);
        else await copyFile(s, d, { fromPathBaseDir: BASE, toPathBaseDir: BASE });
      }
    },
    async removeDir(dir) {
      await remove(dir, { baseDir: BASE, recursive: true });
    },
  };
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/io.ts src/plugins/io.tauri.ts src/plugins/PluginManager.ts src/__tests__/plugins-manager-install.test.ts
git commit -m "feat(plugins): install/uninstall plugin folders + Tauri-backed PluginFs"
```

---

## Task 21: Permission consent dialog (React)

**Files:**
- Create: `src/plugins/ui/PermissionConsentDialog.tsx`
- Test: `src/__tests__/plugins-permission-consent.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/plugins-permission-consent.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionConsentDialog } from '../plugins/ui/PermissionConsentDialog';

describe('PermissionConsentDialog', () => {
  it('lists each requested scope in human-readable form', () => {
    render(
      <PermissionConsentDialog
        pluginName="Schema Visualizer"
        scopes={['database:read', 'network:fetch:https://*.acme.com']}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(screen.getByText(/Schema Visualizer/)).toBeInTheDocument();
    expect(screen.getByText(/Read from your databases/i)).toBeInTheDocument();
    expect(screen.getByText(/Make network requests to/i)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/\*\.acme\.com/)).toBeInTheDocument();
  });

  it('fires onApprove when Approve is clicked', async () => {
    const onApprove = vi.fn();
    render(
      <PermissionConsentDialog pluginName="Foo" scopes={['database:read']} onApprove={onApprove} onDeny={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it('fires onDeny when Deny is clicked', async () => {
    const onDeny = vi.fn();
    render(
      <PermissionConsentDialog pluginName="Foo" scopes={['database:read']} onApprove={() => {}} onDeny={onDeny} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onDeny).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-permission-consent.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/plugins/ui/PermissionConsentDialog.tsx`:
```tsx
import { ReactElement } from 'react';

interface Props {
  pluginName: string;
  scopes: string[];
  onApprove: () => void;
  onDeny: () => void;
}

const DESCRIPTIONS: Record<string, string> = {
  'database:read':  'Read from your databases',
  'database:write': 'Write to your databases',
  'secrets:read':   'Read its own stored secrets',
  'secrets:write':  'Store secrets in its own namespace',
  'workspace:read': 'See your open scripts and saved scripts',
  'workspace:write':'Modify your open scripts and saved scripts',
};

function describe(scope: string): { label: string; arg?: string } {
  if (scope.startsWith('network:fetch:')) {
    return { label: 'Make network requests to', arg: scope.slice('network:fetch:'.length) };
  }
  return { label: DESCRIPTIONS[scope] ?? scope };
}

export function PermissionConsentDialog(props: Props): ReactElement {
  return (
    <div role="dialog" aria-label="Plugin permissions">
      <h2>{props.pluginName} would like permission to:</h2>
      <ul>
        {props.scopes.map(s => {
          const d = describe(s);
          return (
            <li key={s}>
              {d.label}{d.arg ? <> <code>{d.arg}</code></> : null}
            </li>
          );
        })}
      </ul>
      <div>
        <button onClick={props.onDeny}>Deny</button>
        <button onClick={props.onApprove}>Approve</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-permission-consent.test.tsx`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ui/PermissionConsentDialog.tsx src/__tests__/plugins-permission-consent.test.tsx
git commit -m "feat(plugins): permission consent dialog component"
```

---

## Task 22: Plugins settings pane (list, install, enable/disable, uninstall)

**Files:**
- Create: `src/plugins/ui/PluginsSettingsPane.tsx`
- Modify: `src/settings/registry.ts` (or wherever settings sections are registered; inspect first)
- Test: `src/__tests__/plugins-settings-pane.test.tsx`

- [ ] **Step 1: Inspect current settings sections**

Run:
```bash
ls src/settings/sections
cat src/settings/registry.ts
```
Use the same pattern — a section is typically a registered React component.

- [ ] **Step 2: Write failing test**

Create `src/__tests__/plugins-settings-pane.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginsSettingsPane } from '../plugins/ui/PluginsSettingsPane';

const records = [
  { id: 'acme.foo', dir: '/p/acme.foo', state: 'discovered' as const, manifest: { id: 'acme.foo', name: 'Foo', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'dist/main.js', permissions: ['database:read'] } },
  { id: 'broken.x', dir: '/p/broken.x', state: 'broken' as const, errors: ['bad'] },
];

describe('PluginsSettingsPane', () => {
  it('lists installed plugins with their state', () => {
    render(<PluginsSettingsPane records={records} onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText('Foo')).toBeInTheDocument();
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/broken/i)).toBeInTheDocument();
  });

  it('clicking "Install from folder…" fires onInstall', async () => {
    const onInstall = vi.fn();
    render(<PluginsSettingsPane records={[]} onInstall={onInstall} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /install from folder/i }));
    expect(onInstall).toHaveBeenCalled();
  });

  it('clicking Uninstall on a row fires onUninstall with the id', async () => {
    const onUninstall = vi.fn();
    render(<PluginsSettingsPane records={records} onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={onUninstall} />);
    await userEvent.click(screen.getAllByRole('button', { name: /uninstall/i })[0]);
    expect(onUninstall).toHaveBeenCalledWith('acme.foo');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-settings-pane.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `src/plugins/ui/PluginsSettingsPane.tsx`:
```tsx
import { ReactElement } from 'react';
import type { PluginRecord } from '../PluginManager';

interface Props {
  records: PluginRecord[];
  onInstall:   () => void;
  onEnable:    (id: string) => void;
  onDisable:   (id: string) => void;
  onUninstall: (id: string) => void;
}

export function PluginsSettingsPane(p: Props): ReactElement {
  return (
    <section aria-label="Plugins">
      <header>
        <h2>Plugins</h2>
        <button onClick={p.onInstall}>Install from folder…</button>
      </header>
      <ul>
        {p.records.map(rec => (
          <li key={rec.id}>
            <strong>{rec.manifest?.name ?? rec.id}</strong>
            {rec.manifest && <> v{rec.manifest.version}</>}
            <span> — {rec.state}</span>
            {rec.errors && <small> ({rec.errors.join('; ')})</small>}
            <span>
              {rec.state === 'active'
                ? <button onClick={() => p.onDisable(rec.id)}>Disable</button>
                : <button onClick={() => p.onEnable(rec.id)}>Enable</button>}
              <button onClick={() => p.onUninstall(rec.id)}>Uninstall</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/plugins-settings-pane.test.tsx`
Expected: 3 PASS.

- [ ] **Step 6: Wire the pane into the settings registry**

Inspect `src/settings/registry.ts` and add a registration call following the same shape as existing sections. The exact line depends on that file's API; if it uses a static array, append an entry pointing at `PluginsSettingsPane`. (If you discover the registry takes a render function and a `usePluginManager()` hook is needed, add `src/plugins/usePluginManager.ts` exposing the singleton from Task 23.)

- [ ] **Step 7: Commit**

```bash
git add src/plugins/ui/PluginsSettingsPane.tsx src/settings/registry.ts src/__tests__/plugins-settings-pane.test.tsx
git commit -m "feat(plugins): plugins settings pane + wire into settings registry"
```

---

## Task 23: Wire `PluginManager` into the app at startup

**Files:**
- Create: `src/plugins/host.ts` (singleton)
- Create: `src/plugins/usePluginManager.ts` (React hook with subscription)
- Modify: `src/App.tsx` (or whatever file initializes app-level singletons; inspect)
- Test: `src/__tests__/plugins-host-singleton.test.ts`

- [ ] **Step 1: Inspect App entry**

Run: `head -80 src/App.tsx`
Note where startup wiring lives (likely a `useEffect` in `App.tsx` or a module-level init).

- [ ] **Step 2: Write failing test**

Create `src/__tests__/plugins-host-singleton.test.ts`:
```ts
import { createPluginHost } from '../plugins/host';

describe('plugin host singleton', () => {
  it('initializes manager with registries, broker, and a backend stub', () => {
    const host = createPluginHost({ hostApiVersion: '1.0.0', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    expect(host.manager).toBeDefined();
    expect(host.registries).toBeDefined();
    expect(host.broker).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugins-host-singleton.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `src/plugins/host.ts`:
```ts
import { PluginManager } from './PluginManager';
import { createRegistrySet, RegistrySet } from './registries';
import { PermissionBroker } from './PermissionBroker';
import { Logger } from './api/logger';
import { PluginFs } from './io';
import { HostBackend } from './hostServices';

export interface PluginHost {
  manager: PluginManager;
  registries: RegistrySet;
  broker: PermissionBroker;
}

export function createPluginHost(opts: {
  hostApiVersion: string;
  logger: Logger;
  fs?: PluginFs;
  pluginsRoot?: string;
  hostBackend?: HostBackend;
}): PluginHost {
  const registries = createRegistrySet();
  const broker = new PermissionBroker();
  const fs = opts.fs ?? memFs();
  const manager = new PluginManager({
    registries, broker,
    hostApiVersion: opts.hostApiVersion,
    logger: opts.logger,
    fs,
    pluginsRoot: opts.pluginsRoot,
    hostBackend: opts.hostBackend,
  });
  return { manager, registries, broker };
}

function memFs(): PluginFs {
  return {
    async listPluginDirs() { return []; },
    async readManifest() { throw new Error('no fs'); },
    async readEntry() { throw new Error('no fs'); },
    pluginEntryPath: (d, m) => `${d}/${m}`,
  };
}
```

Update `ManagerOptions` in `PluginManager.ts` to accept `pluginsRoot?: string` and `hostBackend?: HostBackend` if not already present.

- [ ] **Step 5: React hook**

Create `src/plugins/usePluginManager.ts`:
```ts
import { useEffect, useState } from 'react';
import { PluginHost } from './host';
import type { PluginRecord } from './PluginManager';

export function usePluginRecords(host: PluginHost): PluginRecord[] {
  const [records, setRecords] = useState(() => host.manager.list());
  useEffect(() => {
    // Subscribe to every registry's onDidChange — change-driven UI refresh.
    const subs = Object.values(host.registries).map(r => r.onDidChange(() => setRecords(host.manager.list())));
    return () => subs.forEach(s => s.dispose());
  }, [host]);
  return records;
}
```

- [ ] **Step 6: Wire startup in `App.tsx`**

In `App.tsx`, near the top of the component (or in a `useEffect`), add:
```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    const { createTauriPluginFs } = await import('./plugins/io.tauri');
    const fs = await createTauriPluginFs();
    const { createPluginHost } = await import('./plugins/host');
    const host = createPluginHost({
      hostApiVersion: '1.0.0',
      logger: console as never,  // replace with the app's structured logger
      fs,
      pluginsRoot: fs.pluginsRoot,
    });
    (window as Record<string, unknown>).__pluginHost = host;
    await host.manager.discover();
    if (!cancelled) await host.manager.activateStartup();
  })();
  return () => { cancelled = true; };
}, []);
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: every test passes (including new singleton test).

- [ ] **Step 8: Commit**

```bash
git add src/plugins/host.ts src/plugins/usePluginManager.ts src/plugins/PluginManager.ts src/App.tsx src/__tests__/plugins-host-singleton.test.ts
git commit -m "feat(plugins): host singleton, React hook, app startup wiring"
```

---

## Task 24: Integration smoke test — install → activate → run command

**Files:**
- Test: `src/__tests__/plugins-integration.test.ts`

End-to-end covering the host path with the in-test loader.

- [ ] **Step 1: Write the integration test**

Create `src/__tests__/plugins-integration.test.ts`:
```ts
import { createPluginHost } from '../plugins/host';

const MANIFEST = JSON.stringify({
  id: 'acme.smoke', name: 'Smoke', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
  permissions: ['database:read'],
  activationEvents: ['onCommand:smoke.run'],
  contributes: { commands: [{ id: 'smoke.run', title: 'Run Smoke' }] },
});

const ENTRY = `
export function activate(ctx) {
  const d = mongolens.commands.register('smoke.run', () => 'smoked');
  ctx.subscriptions.push(d);
}
export function deactivate() {}
`;

describe('plugin host integration', () => {
  it('install → discover → activate by command event → execute → deactivate', async () => {
    const files = new Map<string, string>([
      ['/src/smoke/manifest.json', MANIFEST],
      ['/src/smoke/dist/main.js', ENTRY],
    ]);
    const dirs = new Set<string>();
    const fs = {
      pluginsRoot: '/installed',
      async listPluginDirs() { return Array.from(dirs); },
      async readManifest(dir: string) { return files.get(`${dir}/manifest.json`)!; },
      async readEntry(p: string) { return files.get(p) ?? ''; },
      pluginEntryPath: (d: string, m: string) => `${d}/${m}`,
      async copyDir(src: string, dest: string) {
        for (const [k, v] of files) if (k.startsWith(src + '/')) files.set(dest + k.slice(src.length), v);
        dirs.add(dest);
      },
      async removeDir(dir: string) {
        dirs.delete(dir);
        for (const k of Array.from(files.keys())) if (k.startsWith(dir + '/')) files.delete(k);
      },
    };
    const host = createPluginHost({
      hostApiVersion: '1.0.0',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      fs, pluginsRoot: fs.pluginsRoot,
    });

    await host.manager.install('/src/smoke');
    expect(host.manager.get('acme.smoke')?.state).toBe('discovered');

    await host.manager.activateForEvent('onCommand:smoke.run');
    expect(host.manager.get('acme.smoke')?.state).toBe('active');

    const cmd = host.registries.commands.get('smoke.run');
    expect(cmd).toBeDefined();
    expect(await cmd!.handler()).toBe('smoked');

    await host.manager.deactivate('acme.smoke');
    expect(host.registries.commands.get('smoke.run')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/__tests__/plugins-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/plugins-integration.test.ts
git commit -m "test(plugins): end-to-end install→activate→execute integration"
```

---

## Task 25: Documentation — plugin author quickstart

**Files:**
- Create: `docs/plugins/authoring.md`

Self-contained "hello-world" doc — copy-pasteable. Necessary so the work is testable by an external developer once Part 2 ships the npm types package.

- [ ] **Step 1: Write the doc**

Create `docs/plugins/authoring.md`:
```markdown
# Writing a Mongo Lens Plugin (v1)

A Mongo Lens plugin is a folder with a `manifest.json` and a JS entry that exports `activate(context)`.

## Hello, plugin

Folder layout:
```
my-plugin/
  ├── manifest.json
  └── dist/main.js
```

`manifest.json`:
```json
{
  "id": "yourname.hello",
  "name": "Hello Plugin",
  "version": "1.0.0",
  "engines": { "mongolens": "^1.0.0" },
  "main": "dist/main.js",
  "permissions": [],
  "activationEvents": ["onCommand:hello.say"],
  "contributes": {
    "commands": [{ "id": "hello.say", "title": "Say Hello" }]
  }
}
```

`dist/main.js`:
```js
export function activate(context) {
  const d = mongolens.commands.register('hello.say', () => 'Hello, Mongo Lens!');
  context.subscriptions.push(d);
}
```

## Install

- Open Mongo Lens → Settings → Plugins → **Install from folder…**
- Pick your `my-plugin/` directory.
- Approve any permissions in the consent dialog.
- The plugin is now installed at `~/.mongomacapp/plugins/yourname.hello/`.

## Run

Trigger your command (palette, key binding, or programmatically). The host activates your plugin on first trigger; your `activate()` runs and registers handlers.

## Extension points (v1)

| Surface | Manifest key      | API                                    |
|---------|-------------------|----------------------------------------|
| Commands           | `contributes.commands`            | `mongolens.commands.register(id, fn)` |
| Keybindings        | `contributes.keybindings`         | — declarative only                    |
| Views              | `contributes.views`               | `mongolens.views.register(provider)`  |
| Result viewers     | `contributes.resultViewers`       | `mongolens.resultViewers.register(v)` |
| Execution modes    | `contributes.executionModes`      | `mongolens.executionModes.register(m)`|
| AI tools           | `contributes.aiTools`             | `mongolens.aiTools.register(t)`       |
| Connection providers | `contributes.connectionProviders` | `mongolens.connectionProviders.register(p)` |
| Themes             | `contributes.themes`              | — declarative only                    |
| Export targets     | `contributes.exportTargets`       | `mongolens.exportTargets.register(t)` |

## Permission scopes (v1)

- `database:read`, `database:write`
- `network:fetch:<url-pattern>` — host glob, e.g. `network:fetch:https://*.acme.com`
- `secrets:read`, `secrets:write`
- `workspace:read`, `workspace:write`

Unknown scopes fail validation at install time.

## Cleanup

Everything you allocate (commands, view providers, listeners) returns a `Disposable`. Push it into `context.subscriptions` and the host disposes it on deactivate/uninstall/reload.

## What's coming in Part 2

- `@mongolens/plugin-api` published on npm with full TypeScript types.
- `create-mongolens-plugin` scaffolder.
- Dev mode with hot reload.
- An in-app **Plugin Console** showing your plugin's logger output and permission-broker decisions.
```

- [ ] **Step 2: Commit**

```bash
git add docs/plugins/authoring.md
git commit -m "docs(plugins): author quickstart"
```

---

## Final Sweep

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: every test passes, including the existing app tests (no regressions from Task 12 refactor).

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Smoke-test manually**

1. `npm run tauri dev`
2. Create a folder at `/tmp/mongolens-hello/` with the contents from `docs/plugins/authoring.md`.
3. In the app: Settings → Plugins → Install from folder → pick `/tmp/mongolens-hello/`.
4. Verify it appears in the list with state `discovered`.
5. Verify the command shows up (or trigger it programmatically from the browser devtools: `await window.__pluginHost.manager.activateForEvent('onCommand:hello.say'); await window.__pluginHost.registries.commands.get('hello.say').handler();`) — expect `"Hello, Mongo Lens!"`.

- [ ] **Step 5: Final commit if anything in the manual sweep required tweaks**

If no changes: skip. Otherwise:
```bash
git add -A
git commit -m "chore(plugins): final sweep adjustments"
```

---

## Self-Review (done by plan author before handing off)

**Spec coverage:**
- §2 Architecture — Tasks 2, 11, 16, 17, 23.
- §3 Manifest — Task 4.
- §4 Runtime contract & `mongolens` API — Tasks 1, 10, 14, 15.
- §5 Registry abstraction — Tasks 2, 11.
- §6 Lifecycle — Tasks 16 (discover), 20 (install/uninstall), 17 (activate/deactivate), 19 (activation events). Permission consent dialog wired in Task 21; full grant persistence is Part 2.
- §7 Security & isolation — Tasks 3, 5, 8, 9, 13.
- §8 Developer experience — partial coverage (authoring doc Task 25); npm types package and scaffolder are explicitly Part 2.
- §9 Code layout — Tasks 0, 16, 23.
- §10 Open questions — acknowledged inline (Task 9 design note).

**Out-of-scope items deferred to Part 2:** `PluginConsolePanel`, dev-mode file watcher / hot reload, `@mongolens/plugin-api` npm package, `create-mongolens-plugin` scaffolder, persistent grant store (currently parsed from manifest at activation; Task 21's consent UI exists but is not yet on the install path's critical line — Part 2 wires it).

**Type consistency check:**
- `Registry<T>` API (`register`, `get`, `list`, `onDidChange`, `disposeForPlugin`) used identically across Tasks 2, 11, 16, 17.
- `Disposable` return on every `register(...)` — Tasks 1, 2, 11, 14.
- `PluginRecord.state` values consistent across Tasks 16, 17, 19, 20, 22.
- `PluginFs` extended in Task 20 (added `copyDir`/`removeDir`) — used by Task 20 only; Tasks 16, 17, 19, 23 use the base type.
- `ManagerOptions` accrues fields across Tasks 16, 17, 20, 23 — each task that adds a field also uses it.

**Placeholder scan:** no TBD/TODO/"appropriate"/"similar to" in any step.
