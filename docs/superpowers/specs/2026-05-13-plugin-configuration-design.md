# Plugin Configuration (`contributes.configuration`) — Design

**Date:** 2026-05-13
**Status:** Draft, awaiting user review
**Depends on:** `2026-05-13-plugin-enforcement-design.md` (enforcement registry, findings UI), `2026-04-26-master-key-keychain-design.md` (OS keychain backend)

## Problem

Plugins today have no host-mediated way to let a user set configuration. Datafleet is the canonical case: the plugin needs an LDAP `username` + `password`, and currently hand-rolls a credential form inside its own sidebar view (`RequestsView.tsx:272-280`) — the user types creds every session because there is nowhere to persist them. Every plugin that wants user-supplied values has to reinvent this UI and storage path.

The host already exposes `mongolens.secrets.*` and a per-plugin `WorkspaceStore`, but they are runtime-keyed: the plugin must call `.store(k, v)` itself. There is no flow for the user to enter a value and have the host hand it to the plugin.

## Goals

- A `contributes.configuration` manifest field where a plugin declares its settings via a JSON Schema subset.
- A `mongolens.config.get/set/onDidChange` API that returns values without the plugin caring whether they came from the workspace store or the OS keychain.
- A host-rendered settings form mounted (a) inline in the plugin's detail pane and (c) as a dedicated full-pane route reachable from the detail pane.
- An activation gate that lets a plugin opt into "won't enable until required config is set," reusing the enforcement registry built in the companion spec.
- OS-keychain persistence for `x-secret` values via the existing master-key infrastructure.
- Cross-field undo/redo within an unsaved form session.
- Extensibility: adding a new field type (e.g. `date`, custom range slider) is one new file + one register call.

## Non-goals

- Schema migration when a plugin updates and changes its schema. Future feature.
- Multi-window save coordination. Tauri is single-window today.
- Plugin-supplied custom config UI. The host renders from the schema; if a plugin wants a non-schema-driven UI, it builds its own view as today.
- Per-workspace vs per-user scopes. v1 is single-scope (per user, per plugin).
- Persisted undo across sessions ("revert last save"). Out of scope.

## Locked design decisions (from brainstorming)

| # | Question | Locked answer |
|---|---|---|
| Q1 | Schema vocabulary | Full JSON Schema subset (`type`, `properties`, `items`, `required`, `enum`, `default`, `description`, `title`, `minimum/maximum`, `minLength/maxLength`, `pattern`, `format`) + custom `x-secret: true` |
| Q2 | API shape | Unified flat `mongolens.config.get/set/onDidChange`; host routes by schema |
| Q3 | Change notifications | Event subscription (`onDidChange`) |
| Q4 | UI placement | Inline section in detail pane **and** dedicated route — same form component, two mount points |
| Q5 | Secret storage | OS keychain via master-key infrastructure |
| Q6 | Required-config gating | Per-plugin opt-in via `activation.requireConfig: true` |
| Q7 | Save semantics | Explicit Save / Cancel with batched `onDidChange` |
| Q8 | Undo/redo | Session-scoped cross-field stack (cap 50), clears on Save/Cancel |

## Architecture

### Module layout

```
src/plugins/config/
  types.ts                  ConfigSchema, ConfigValue, ConfigChangeEvent, JSONSchemaProperty
  schemaValidator.ts        Ajv-based schema validation (extends existing manifest Ajv)
  keychainBackend.ts        KeychainBackend interface + InMemoryKeychainBackend
  keychainBackend.tauri.ts  TauriKeychainBackend implementation
  ConfigStore.ts            Per-plugin store; routes by x-secret to keychain or workspace
  ConfigService.ts          The mongolens.config impl (get/set/getAll/save/onDidChange)
  fieldRenderers/
    index.ts                FieldRendererRegistry + default registrations
    StringField.tsx         text input (handles enum → select, format hints)
    NumberField.tsx         number input (handles minimum/maximum)
    BooleanField.tsx        checkbox
    SecretField.tsx         password input + reveal toggle
    ArrayField.tsx          add/remove rows; delegates to child renderer
    ObjectField.tsx         collapsible nested form
  index.ts                  public exports + default service instance factory

src/plugins/enforcement/rules/
  requiredConfig.ts         new built-in rule (block when required keys unset and requireConfig:true)

src/plugins/ui/
  PluginConfigForm.tsx      schema → form; reducer state; undo/redo; renders from FieldRenderer registry
  PluginConfigRoute.tsx     the dedicated full-pane view
```

### Modified files

- `src/plugins/manifest.ts` — add `ConfigurationContribution` interface, `activation?.requireConfig`, `JSONSchemaProperty`.
- `src/plugins/schema/manifest.schema.json` — add `contributes.configuration` and `activation.requireConfig` to the JSON schema; reject unknown keywords under config properties.
- `src/plugins/PluginManager.ts` — construct `ConfigService` per plugin, expose `recheckEnforcement(pluginId)`, pass `workspace` + `keychain` into `RuleContext`.
- `src/plugins/enforcement/types.ts` — add optional `workspace?: WorkspaceStore` and `keychain?: KeychainBackend` to `RuleContext`.
- `src/plugins/enforcement/index.ts` — register `requiredConfigRule` in `defaultEnforcementRegistry`.
- `src/plugins/ui/PluginDetailPane.tsx` — embed `PluginConfigForm` in a new Settings section (only when `contributes.configuration` is declared) plus a link to the dedicated route.
- `src/plugins/api/createMongolens.ts` — expose `mongolens.config` from the per-plugin `ConfigService`.
- `src/plugins/api/secretStorage.ts` — re-implement `InMemorySecretStorage` as a thin wrapper over `KeychainBackend` so there is one storage seam for all secrets.

### Manifest additions

```json
{
  "activation": {
    "requireConfig": true
  },
  "contributes": {
    "configuration": {
      "title": "Datafleet",
      "properties": {
        "datafleet.apiUrl": {
          "type": "string",
          "title": "API URL",
          "default": "https://datafleet.example.com",
          "format": "uri",
          "description": "Base URL of the DataFleet endpoint."
        },
        "datafleet.username": { "type": "string", "title": "Username", "minLength": 1 },
        "datafleet.password": { "type": "string", "title": "Password", "x-secret": true, "minLength": 1 },
        "datafleet.requestTimeoutMs": {
          "type": "integer", "title": "Request timeout (ms)",
          "default": 30000, "minimum": 1000, "maximum": 300000
        }
      },
      "required": ["datafleet.apiUrl", "datafleet.username", "datafleet.password"]
    }
  }
}
```

**TypeScript additions in `manifest.ts`:**

```ts
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'uri' | 'email' | 'date' | string;
  items?: JSONSchemaProperty;                       // for type: 'array'
  properties?: Record<string, JSONSchemaProperty>;  // for type: 'object'
  required?: string[];                              // for type: 'object'
  'x-secret'?: boolean;                             // string only
}

export interface ConfigurationContribution {
  title: string;
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface PluginManifest {
  // ...existing fields...
  activation?: { requireConfig?: boolean };
  contributes?: {
    // ...existing...
    configuration?: ConfigurationContribution;
  };
}
```

**Supported JSON Schema keywords** (anything else is rejected at install time, not silently ignored):

| Keyword | Applies to | Notes |
|---|---|---|
| `type` | all | five primitives + `array`, `object` |
| `title`, `description` | all | UI labels |
| `default` | all | returned from `get()` when stored value absent |
| `enum` | string/number/integer | dropdown renderer |
| `minimum`, `maximum` | number/integer | inline validation |
| `minLength`, `maxLength`, `pattern` | string | inline validation |
| `items` | array | child schema |
| `properties`, `required` | object/root | nested form |
| `format` | string | renderer hint (not validation in v1) |
| `x-secret` | string | routes to keychain + renders as password input |

Manifest validation at install rejects unknown keywords using an Ajv meta-schema. This keeps the vocabulary frozen and well-defined.

### Plugin-facing API

```ts
interface MongolensConfig {
  get<T = unknown>(key: string): Promise<T | undefined>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  onDidChange(listener: (e: ConfigChangeEvent) => void): Disposable;
}

interface ConfigChangeEvent {
  keys: string[];                          // keys that actually changed in this Save
  values: Record<string, unknown>;         // new values; secrets omitted unless listener has secrets:read
}
```

- `get`/`getAll` return schema defaults when storage is empty.
- `set` validates against the schema; throws on failure. Used for programmatic migration or "Reset to defaults" UX — settings are normally edited by the user via the host UI.
- `onDidChange` fires once per Save (batched). The Disposable goes into `context.subscriptions` like every other host resource.
- Reading `x-secret` values requires the plugin's existing `secrets:read` scope. A plugin that declares secret config without `secrets:read` can never observe the value — useful when the host should hand secrets straight to a backend (e.g. a connection provider) without the plugin code seeing them.

**Datafleet usage:**

```ts
export async function activate(context) {
  const { get, onDidChange } = mongolens.config;

  let cfg = {
    apiUrl:    await get<string>('datafleet.apiUrl'),
    username:  await get<string>('datafleet.username'),
    password:  await get<string>('datafleet.password'),
    timeoutMs: await get<number>('datafleet.requestTimeoutMs'),
  };
  let client = makeClient(cfg);

  context.subscriptions.push(onDidChange(async ({ keys }) => {
    if (keys.some(k => k.startsWith('datafleet.'))) {
      cfg = { ...cfg,
        apiUrl:    await get<string>('datafleet.apiUrl'),
        username:  await get<string>('datafleet.username'),
        password:  await get<string>('datafleet.password'),
        timeoutMs: await get<number>('datafleet.requestTimeoutMs'),
      };
      client = makeClient(cfg);
    }
  }));
}
```

### Form component

**`PluginConfigForm`** — single React component, two mount points.

```tsx
interface Props {
  schema: ConfigurationContribution;
  initialValues: Record<string, unknown>;
  onSave:   (values: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  compact?: boolean;   // inline mount; hides title + flattens to single column
}
```

**State:** reducer-managed `{ values, dirtyKeys, errors, undoStack, redoStack }`.

**Field rendering:** walks the schema, calls `fieldRendererRegistry.find(propertySchema)` per property, renders the result. Registry uses a matcher pattern (first match wins):

```ts
interface FieldRenderer {
  matches(schema: JSONSchemaProperty): boolean;
  render(props: FieldRendererProps): React.ReactNode;
}

interface FieldRendererProps {
  schema: JSONSchemaProperty;
  value: unknown;
  error?: string;
  onCommit(value: unknown): void;  // called on blur or explicit commit
}
```

Default renderers in registration order:

1. `SecretField` — matches `string + x-secret:true`
2. `StringField` — matches `string` (with `enum` → `<select>`, `format` for hint)
3. `NumberField` — matches `number` and `integer`
4. `BooleanField` — matches `boolean`
5. `ArrayField` — matches `array`, recurses via registry for child renderer
6. `ObjectField` — matches `object`, recurses for properties

Adding a new field type (e.g. `string + format: 'date'` → a date picker) is one new file under `fieldRenderers/` plus one `registerFieldRenderer(...)` call. The default `StringField`'s matcher uses lowest priority, so custom registrations take precedence naturally.

**Commit handling:** every `onCommit` from a renderer:

1. Validates the new value against the property schema.
2. Updates `values`; marks key dirty.
3. Pushes the previous `values` snapshot onto `undoStack`; clears `redoStack`.
4. Re-validates the whole form; updates `errors`.

**Undo/redo:** ⌘Z (Ctrl+Z on non-Mac) → pop `undoStack` → push current onto `redoStack` → apply popped state. ⌘⇧Z (Ctrl+Y) reverses. Listener bound at form root; ignores when focus is inside a field that's mid-IME-compose. Stacks capped at 50; 51st push drops oldest. Native browser within-field undo still works for text editing.

**Save:** disabled when `errors` non-empty or `dirtyKeys.length === 0`. On click → `onSave(values)` → on resolve, reset `dirtyKeys` and clear both stacks. The form is intentionally not told which keys "actually changed" — the service computes that authoritatively from storage diffs and uses it in the event payload.

**Cancel:** revert `values` to `initialValues`; clear dirtyKeys, errors, both stacks; call `onCancel`.

### UI mount points

**Inline (mount A):** in `PluginDetailPane`, only when `manifest.contributes?.configuration` exists. Position:

```
[header + Enable/Disable/Uninstall]
[findings — including any "required config" finding]
[Settings (compact)]
  ├─ section heading + "Open in dedicated view →" link
  └─ <PluginConfigForm compact />
[README]
```

**Dedicated route (mount C):** `PluginConfigRoute` is mounted from a "Configure…" button in the detail pane header or from the inline section's link. Layout:

- Breadcrumb: "Plugins / Datafleet / Settings" with back link to the detail pane.
- `<PluginConfigForm />` (non-compact): two-column layout for short-description fields; full description below long ones.
- Designed so a 20-field schema is still navigable.

Both mounts read from the same `ConfigStore` via `ConfigService`. Saving in one is reflected when the other mounts (initial values are re-fetched on mount).

### Storage routing

**`ConfigStore` (one per plugin):**

```ts
class ConfigStore {
  constructor(
    private readonly pluginId: string,
    private readonly schema: ConfigurationContribution,
    private readonly workspace: WorkspaceStore,
    private readonly keychain: KeychainBackend,
  ) {}

  async getAll(): Promise<Record<string, unknown>>;
  async getOne(key: string): Promise<unknown>;
  async setMany(values: Record<string, unknown>): Promise<string[]>;  // returns keys that actually changed
}
```

For each property, the store reads `x-secret` and routes accordingly:

| `x-secret` | Backend | Namespace |
|---|---|---|
| `true` | `KeychainBackend` | `plugin:<pluginId>:config:<key>` |
| absent / `false` | `WorkspaceStore` | `plugin.<pluginId>.config.<key>` |

`setMany` is atomic across backends: if any keychain write throws, no workspace writes are committed either. Implemented by buffering plain-key writes until all secret writes have succeeded.

### `KeychainBackend`

New interface (file `src/plugins/config/keychainBackend.ts`):

```ts
export interface KeychainBackend {
  get(namespace: string): Promise<string | undefined>;
  set(namespace: string, value: string): Promise<void>;
  delete(namespace: string): Promise<void>;
}

export class KeychainLockedError extends Error {}
```

**Implementations:**

- `TauriKeychainBackend` — calls the Rust master-key API specced in `2026-04-26-master-key-keychain-design.md`. The first task of the implementation plan reads that spec, confirms the public Rust surface, and produces this wrapper.
- `InMemoryKeychainBackend` — Map-backed; used when no Tauri runtime is present (test, dev, headless). Same pattern as `InMemorySecretStorage` today.

`SecretStorage` (existing) becomes a thin wrapper over the same `KeychainBackend` with namespace `plugin:<pluginId>:secret:<key>` — one keychain seam app-wide, two consumers, no namespace collision.

### `ConfigService`

```ts
class ConfigService {
  constructor(
    private readonly pluginId: string,
    private readonly schema: ConfigurationContribution,
    private readonly store: ConfigStore,
    private readonly broker: PermissionBroker,
    private readonly manager: PluginManager,  // for recheckEnforcement
  ) {}

  async get<T>(key: string): Promise<T | undefined>;          // applies secrets:read scope check
  async getAll(): Promise<Record<string, unknown>>;           // applies secrets:read scope check
  async set(key: string, value: unknown): Promise<void>;      // validates against schema
  async save(values: Record<string, unknown>): Promise<void>; // batched; fires onDidChange; calls recheckEnforcement
  onDidChange(listener: (e: ConfigChangeEvent) => void): Disposable;
}
```

`save()` is what the form calls on Save:

1. Ajv-validate the merged values against the full schema.
2. `store.setMany(values)` → returns `changedKeys`.
3. If `changedKeys.length === 0` → return without firing event.
4. Build event payload: include all changed keys; include values, omitting secrets if the listener doesn't have `secrets:read` (per-listener filtering).
5. Fire `onDidChange` to all listeners.
6. Call `manager.recheckEnforcement(pluginId)`.

Concurrency: single in-flight `save` promise per plugin id; second call awaits the first.

### Activation gate

New built-in rule `requiredConfigRule` in `src/plugins/enforcement/rules/requiredConfig.ts`:

```ts
export const requiredConfigRule: Rule = {
  id: 'core.required-config',
  title: 'Required configuration must be set',
  defaultSeverity: 'warning',
  async check({ manifest, workspace, keychain }) {
    const cfg = manifest.contributes?.configuration;
    const required = cfg?.required ?? [];
    if (required.length === 0 || !workspace || !keychain) return [];

    const store = new ConfigStore(manifest.id, cfg!, workspace, keychain);
    const stored = await store.getAll();
    const missing = required.filter(k => stored[k] === undefined || stored[k] === '');
    if (missing.length === 0) return [];

    const blocking = manifest.activation?.requireConfig === true;
    return [{
      ruleId: 'core.required-config',
      severity: blocking ? 'error' : 'warning',
      message: `Required configuration missing: ${missing.join(', ')}`,
      fixHint: "Open the Settings section on this plugin's detail pane and fill in the highlighted fields.",
    }];
  },
};
```

`RuleContext` grows two optional fields:

```ts
export interface RuleContext {
  pluginDir: string;
  manifest: PluginManifest;
  fs: PluginFs;
  workspace?: WorkspaceStore;
  keychain?: KeychainBackend;
}
```

Optional → README rule is unchanged. `PluginManager.loadOne` passes both new fields to `enforcementRegistry.runAll(ctx)`.

`PluginManager.recheckEnforcement(pluginId)` is a new public method:

```ts
async recheckEnforcement(pluginId: string): Promise<void> {
  const rec = this.records.get(pluginId);
  if (!rec || !rec.manifest) return;
  rec.findings = await this.enforcement.runAll({
    pluginDir: rec.dir, manifest: rec.manifest, fs: this.opts.fs,
    workspace: this.opts.workspace, keychain: this.opts.keychain,
  });
  this.emit('changed', { id: pluginId });
}
```

Called by `ConfigService.save` after a successful write. Also available to a future "Recheck" button on the detail pane.

## Data flow

**Initial activation, no config set, `requireConfig: true`:**

1. `discover()` loads manifest → `enforcementRegistry.runAll` → `requiredConfigRule` reads ConfigStore → all three keys missing → emits one `error` finding.
2. Detail pane: Enable disabled, finding visible, Settings form below.
3. User fills fields, clicks Save.
4. `PluginConfigForm.onSave` → `ConfigService.save` validates, writes via `ConfigStore.setMany`, fires `onDidChange` (no subscribers since plugin not active), calls `recheckEnforcement`.
5. `requiredConfigRule` now finds nothing → `record.findings = []` → `hasBlockingFindings(rec)` false.
6. Detail pane re-renders: finding gone, Enable enabled.
7. User clicks Enable → `activate()` runs normally.

**Config change while plugin active:**

1. User edits a value in either mount, Saves.
2. `ConfigStore.setMany` writes via the right backend.
3. `ConfigService` fires one `onDidChange({ keys: [...], values: {...} })`.
4. Plugin's listener reacts (e.g. rebuilds client).
5. `recheckEnforcement` runs; no UI change unless findings actually changed.

## Error handling

| Failure | Surface | Behavior |
|---|---|---|
| Unknown keyword in `contributes.configuration.properties` at install | manifest validator | Plugin enters `broken` state, `errors` populated. Same path as today's manifest errors. |
| Ajv validation fails on form Save | `PluginConfigForm` | Inline `<small className="field-error">` beneath the field; Save button stays disabled. No write. |
| `KeychainLockedError` thrown during save of x-secret key | `ConfigStore.setMany` → `ConfigService.save` → form | Banner: "Unlock keychain to save credentials" + retry. **No plain-key writes** committed in the same save — atomic. |
| Keychain decryption failure on read | `ConfigService.get`/`getAll` | Returns `undefined` for that key; warning logged via plugin logger. `onDidChange` does not fire. Field appears empty in the form; user can re-enter. |
| Plugin calls `mongolens.config.get('x-secret-key')` without `secrets:read` | `ConfigService.get` | Returns `undefined`; broker logs denied access. Same shape as existing broker denials. |
| Plugin calls `mongolens.config.set` with invalid value | `ConfigService.set` | Throws validation error; plugin receives it. Host doesn't swallow. |
| User opens dedicated route for a plugin with no `contributes.configuration` | `PluginConfigRoute` | Empty state: "This plugin has no configurable settings." |
| Two saves race | `ConfigService.save` | Single in-flight promise per plugin id; second call awaits first. No interleaving. |

## Testing

**Unit (vitest):**

1. **`schemaValidator`** — meta-schema accepts the seven types; rejects unknown keywords under `contributes.configuration.properties`; recognizes `x-secret`.
2. **`ConfigStore` routing** — x-secret keys go to `KeychainBackend`; plain keys go to `WorkspaceStore`; namespaces don't collide with `SecretStorage`; `setMany` is atomic on keychain failure.
3. **`InMemoryKeychainBackend`** — get/set/delete round-trip; missing key returns undefined.
4. **`ConfigService.get`/`getAll`** — returns schema default when unset; returns stored value when set; omits x-secret values when broker denies `secrets:read`.
5. **`ConfigService.set`** — single-key validation; throws on invalid; fires `onDidChange` with single-key delta.
6. **`ConfigService.save`** — batched event with only changed keys; calls `recheckEnforcement`; single in-flight per plugin id.
7. **`requiredConfigRule`** — no required keys → no findings; missing + `requireConfig:false` → warning; missing + `requireConfig:true` → error; all set → no findings.
8. **`PluginManager.activate` with required-config gate** — error finding blocks activation; after `recheckEnforcement` clears it, activation succeeds.
9. **`PluginManager.recheckEnforcement`** — re-runs registry; updates record; emits change event.

**Component (react-testing-library):**

10. **`PluginConfigForm` rendering** — every type renders via the correct FieldRenderer; secret field is `type="password"`; enum renders `<select>` with all options; array renders one row per default item.
11. **`PluginConfigForm` validation** — invalid value shows inline error; Save disabled while errors exist; Save disabled with no dirty keys.
12. **`PluginConfigForm` undo/redo** — three commits in sequence, ⌘Z walks back regardless of focus; ⌘⇧Z redoes; Save and Cancel both clear stacks; 51st commit drops oldest; within-field typing creates one commit on blur.
13. **`PluginConfigForm` save/cancel** — Save calls `onSave` with dirty keys and full values; Cancel reverts to `initialValues` and clears stacks; both reset `dirtyKeys`.
14. **`PluginDetailPane` Settings section** — appears only when `contributes.configuration` is declared; compact=true; "Open in dedicated view →" link present.
15. **`PluginConfigRoute`** — renders form with compact=false; back link works; empty state when no schema declared.
16. **`SecretField`** — `type="password"`; reveal toggle switches to `type="text"`; commits on blur.
17. **Field renderer registry** — `find()` returns first matcher; a custom renderer registered for `format: 'date'` takes precedence over default `StringField`.

**Integration:**

18. **End-to-end save → recheck → activate** — plugin with `requireConfig: true` and three required keys: detail pane renders, Enable disabled, fill fields, Save, finding clears, Enable enabled, click, plugin activates, `onDidChange` listener fires on next save.

**No harness tests.** ConfigService runs in the renderer; no sandboxed plugin code change required.

## Files

**New (production):**
- `src/plugins/config/types.ts`
- `src/plugins/config/schemaValidator.ts`
- `src/plugins/config/keychainBackend.ts`
- `src/plugins/config/keychainBackend.tauri.ts`
- `src/plugins/config/ConfigStore.ts`
- `src/plugins/config/ConfigService.ts`
- `src/plugins/config/fieldRenderers/index.ts`
- `src/plugins/config/fieldRenderers/StringField.tsx`
- `src/plugins/config/fieldRenderers/NumberField.tsx`
- `src/plugins/config/fieldRenderers/BooleanField.tsx`
- `src/plugins/config/fieldRenderers/SecretField.tsx`
- `src/plugins/config/fieldRenderers/ArrayField.tsx`
- `src/plugins/config/fieldRenderers/ObjectField.tsx`
- `src/plugins/config/index.ts`
- `src/plugins/enforcement/rules/requiredConfig.ts`
- `src/plugins/ui/PluginConfigForm.tsx`
- `src/plugins/ui/PluginConfigRoute.tsx`

**New (tests):** 18 test files matching the testing strategy above.

**Modified:**
- `src/plugins/manifest.ts`
- `src/plugins/schema/manifest.schema.json`
- `src/plugins/PluginManager.ts` (construct ConfigService; recheckEnforcement; pass workspace+keychain into RuleContext)
- `src/plugins/enforcement/types.ts` (RuleContext gains optional workspace + keychain)
- `src/plugins/enforcement/index.ts` (register `requiredConfigRule`)
- `src/plugins/ui/PluginDetailPane.tsx` (embed PluginConfigForm; "Configure…" link)
- `src/plugins/api/createMongolens.ts` (expose mongolens.config)
- `src/plugins/api/secretStorage.ts` (thin wrapper over KeychainBackend)
- `src/plugins/host.ts` (wire KeychainBackend; pass through to manager)
- `src/plugins/usePluginManager.ts` (expose ConfigService factory or already-built instances; expose KeychainBackend)
- Router or settings shell (whichever currently routes Settings → Plugins) — register the `PluginConfigRoute` path
- `docs/plugins/authoring.md` — document `contributes.configuration`, `x-secret`, `activation.requireConfig`, the API surface, undo/redo behavior

**Untouched:** sandbox, permission broker mechanics (only its `check` callers are added), manifest engine-version handling, harness.

## Extensibility — adding the next field type

Reference example: a date-picker for `string + format: 'date'`.

1. Create `src/plugins/config/fieldRenderers/DateField.tsx` exporting:
   ```ts
   export const dateField: FieldRenderer = {
     matches: (s) => s.type === 'string' && s.format === 'date',
     render: (p) => <input type="date" defaultValue={p.value as string ?? ''}
                           onBlur={(e) => p.onCommit(e.target.value)} />,
   };
   ```
2. In `fieldRenderers/index.ts`, add `registry.register(dateField)` **before** the default `StringField` registration (matcher order = priority).
3. Done. No edits to the form, the schema validator, the registry implementation, or any consumer.

This is the openness-to-extension contract the design is buying — same shape as the enforcement rule registry.

## Open follow-ups (post-v1)

- Schema migration on plugin update (new rule + tooling).
- "Reset to defaults" button in the form header.
- "Recheck" button on detail pane (calls `recheckEnforcement`, useful when files are edited outside the host).
- Persisted undo across sessions / revert-last-save.
- Per-workspace overrides (if multi-workspace ever lands).
- Plugin-supplied custom config UI as an alternative to host-rendered form.
