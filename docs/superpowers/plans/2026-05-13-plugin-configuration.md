# Plugin Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `contributes.configuration` end-to-end: manifest schema, host-rendered settings form with undo/redo, OS-keychain-backed secrets, `mongolens.config.*` plugin API with `onDidChange` events, and an opt-in activation gate for required config — reusing the enforcement registry already in this branch.

**Architecture:** New `src/plugins/config/` module exposes `ConfigService` (per plugin), `ConfigStore` (routes `x-secret` keys to a `KeychainBackend`, plain keys to the existing `WorkspaceStore`), and a `FieldRenderer` registry that drives the form. `PluginConfigForm` is one React component mounted both inline in `PluginDetailPane` and at a dedicated route. Required-config enforcement lands as a new built-in rule (`core.required-config`) in the existing registry; `PluginManager.recheckEnforcement(id)` re-runs rules after a save.

**Tech Stack:** TypeScript, React, Vitest, Ajv (already in repo for manifest validation), Tauri Rust bridge for keychain (existing `set_password / get_password / delete_password` in `src-tauri/src/keychain.rs`).

**Spec:** `docs/superpowers/specs/2026-05-13-plugin-configuration-design.md`
**Depends on:** plugin enforcement registry (already on this branch), master-key keychain (`docs/superpowers/specs/2026-04-26-master-key-keychain-design.md`, already implemented in `src-tauri/src/keychain.rs`).

---

## Phase boundaries (for parallel execution)

- **Phase 1 — Foundation (Tasks 1–8):** Manifest schema, Ajv validators, `KeychainBackend`, `SecretStorage` refactor, `ConfigStore`, `ConfigService`. No UI deps.
- **Phase 2 — Wiring (Tasks 9–12):** RuleContext extension, `requiredConfigRule`, `PluginManager.recheckEnforcement`, `mongolens.config` exposure. Depends on Phase 1.
- **Phase 3 — UI (Tasks 13–21):** Field renderers, `PluginConfigForm` (state + undo/redo), `PluginDetailPane` integration, `PluginConfigRoute`. Tasks 13–17 (renderers) parallel with Phase 1/2; Tasks 18–21 depend on Phase 2.
- **Phase 4 — Glue + docs (Tasks 22–24):** `host.ts` / `usePluginManager`, `authoring.md`, end-to-end integration test.

## File Structure

**New (production):**
- `src/plugins/config/types.ts`
- `src/plugins/config/schemaValidator.ts`
- `src/plugins/config/keychainBackend.ts`
- `src/plugins/config/keychainBackend.tauri.ts`
- `src/plugins/config/ConfigStore.ts`
- `src/plugins/config/ConfigService.ts`
- `src/plugins/config/index.ts`
- `src/plugins/config/fieldRenderers/index.ts`
- `src/plugins/config/fieldRenderers/StringField.tsx`
- `src/plugins/config/fieldRenderers/NumberField.tsx`
- `src/plugins/config/fieldRenderers/BooleanField.tsx`
- `src/plugins/config/fieldRenderers/SecretField.tsx`
- `src/plugins/config/fieldRenderers/ArrayField.tsx`
- `src/plugins/config/fieldRenderers/ObjectField.tsx`
- `src/plugins/enforcement/rules/requiredConfig.ts`
- `src/plugins/ui/PluginConfigForm.tsx`
- `src/plugins/ui/PluginConfigRoute.tsx`
- `src-tauri/src/commands/plugin_secrets.rs`

**New (tests):** 18 vitest files matching the spec's testing strategy.

**Modified:**
- `src/plugins/manifest.ts`
- `src/plugins/schema/manifest.schema.json`
- `src/plugins/PluginManager.ts`
- `src/plugins/enforcement/types.ts`
- `src/plugins/enforcement/index.ts`
- `src/plugins/api/secretStorage.ts`
- `src/plugins/api/createMongolens.ts`
- `src/plugins/ui/PluginDetailPane.tsx`
- `src/plugins/host.ts`
- `src/plugins/usePluginManager.ts`
- `src-tauri/src/main.rs` (register new commands)
- `docs/plugins/authoring.md`

---

### Task 1: Manifest types + Ajv schema additions

**Files:**
- Modify: `src/plugins/manifest.ts`
- Modify: `src/plugins/schema/manifest.schema.json`
- Test: `src/__tests__/plugins-manifest-configuration.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/plugins-manifest-configuration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../plugins/manifest';

const base = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
};

describe('manifest.contributes.configuration', () => {
  it('accepts a well-formed configuration block', () => {
    const v = validateManifest({
      ...base,
      contributes: {
        configuration: {
          title: 'Foo',
          properties: {
            'foo.url':      { type: 'string', title: 'URL' },
            'foo.password': { type: 'string', 'x-secret': true },
            'foo.timeout':  { type: 'integer', minimum: 0, maximum: 1000, default: 30 },
            'foo.enabled':  { type: 'boolean' },
            'foo.mode':     { type: 'string', enum: ['fast', 'slow'] },
          },
          required: ['foo.url'],
        },
      },
    });
    expect(v.ok).toBe(true);
  });

  it('accepts activation.requireConfig', () => {
    const v = validateManifest({ ...base, activation: { requireConfig: true } });
    expect(v.ok).toBe(true);
  });

  it('rejects unknown keyword under a configuration property', () => {
    const v = validateManifest({
      ...base,
      contributes: {
        configuration: {
          title: 'Foo',
          properties: { 'foo.bad': { type: 'string', bogusKeyword: 1 } as never },
        },
      },
    });
    expect(v.ok).toBe(false);
    expect(v.errors?.join(' ')).toMatch(/bogusKeyword|additional/i);
  });

  it('rejects a property with no type', () => {
    const v = validateManifest({
      ...base,
      contributes: { configuration: { title: 'Foo', properties: { 'foo.x': { title: 'x' } as never } } },
    });
    expect(v.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-manifest-configuration.test.ts`
Expected: FAIL — `configuration` is rejected by the current schema (unknown key under `contributes`), `activation` rejected at root.

- [ ] **Step 3: Update `src/plugins/manifest.ts`**

After existing contribution interfaces, add:

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
  format?: string;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  'x-secret'?: boolean;
}

export interface ConfigurationContribution {
  title: string;
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}
```

In the existing `PluginManifest` interface, add the `activation` field (next to `activationEvents`) and `configuration` inside `contributes`:

```ts
export interface PluginManifest {
  // ...existing fields unchanged...
  activation?: { requireConfig?: boolean };
  contributes?: {
    // ...existing contribution lists unchanged...
    configuration?: ConfigurationContribution;
  };
}
```

- [ ] **Step 4: Update `src/plugins/schema/manifest.schema.json`**

Add a `$defs` entry for `jsonSchemaProperty` with `additionalProperties: false` listing the supported keywords, then reference it from a new `contributes.configuration` block and a root-level `activation` block. Concrete diff:

In the JSON schema's root `properties`, add:

```json
"activation": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "requireConfig": { "type": "boolean" }
  }
}
```

In `contributes.properties`, add:

```json
"configuration": {
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "properties"],
  "properties": {
    "title":      { "type": "string" },
    "properties": {
      "type": "object",
      "additionalProperties": { "$ref": "#/$defs/jsonSchemaProperty" }
    },
    "required":   { "type": "array", "items": { "type": "string" } }
  }
}
```

In the root JSON (alongside `$schema`), add `$defs`:

```json
"$defs": {
  "jsonSchemaProperty": {
    "type": "object",
    "additionalProperties": false,
    "required": ["type"],
    "properties": {
      "type":        { "enum": ["string", "number", "integer", "boolean", "array", "object"] },
      "title":       { "type": "string" },
      "description": { "type": "string" },
      "default":     {},
      "enum":        { "type": "array" },
      "minimum":     { "type": "number" },
      "maximum":     { "type": "number" },
      "minLength":   { "type": "integer", "minimum": 0 },
      "maxLength":   { "type": "integer", "minimum": 0 },
      "pattern":     { "type": "string" },
      "format":      { "type": "string" },
      "items":       { "$ref": "#/$defs/jsonSchemaProperty" },
      "properties":  {
        "type": "object",
        "additionalProperties": { "$ref": "#/$defs/jsonSchemaProperty" }
      },
      "required":    { "type": "array", "items": { "type": "string" } },
      "x-secret":    { "type": "boolean" }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-manifest-configuration.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Full plugin suite regression**

Run: `npx vitest run src/__tests__/plugins-manifest.test.ts src/__tests__/plugins-manager-discover.test.ts`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/manifest.ts src/plugins/schema/manifest.schema.json src/__tests__/plugins-manifest-configuration.test.ts
git commit -m "feat(plugins): manifest types + schema for contributes.configuration"
```

---

### Task 2: schemaValidator — per-value runtime validation

**Files:**
- Create: `src/plugins/config/types.ts`
- Create: `src/plugins/config/schemaValidator.ts`
- Test: `src/__tests__/plugins-config-schema-validator.test.ts`

- [ ] **Step 1: Create `types.ts`**

```ts
import type { ConfigurationContribution, JSONSchemaProperty } from '../manifest';

export type { ConfigurationContribution, JSONSchemaProperty };

export interface ConfigValueError {
  key: string;          // dotted path; root keys for v1 (no deep paths until objects ship in a plugin)
  message: string;
}

export interface ConfigChangeEvent {
  keys: string[];
  values: Record<string, unknown>;
}

export interface Disposable { dispose(): void }
```

- [ ] **Step 2: Write failing tests for `validateConfig`**

```ts
import { describe, it, expect } from 'vitest';
import { validateConfig } from '../plugins/config/schemaValidator';
import type { ConfigurationContribution } from '../plugins/manifest';

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    url:     { type: 'string', minLength: 1, format: 'uri' },
    secret:  { type: 'string', 'x-secret': true },
    count:   { type: 'integer', minimum: 0, maximum: 10 },
    mode:    { type: 'string', enum: ['a', 'b'] },
    enabled: { type: 'boolean' },
  },
  required: ['url'],
};

describe('validateConfig', () => {
  it('returns no errors for valid values', () => {
    expect(validateConfig(schema, {
      url: 'https://x', secret: 's', count: 5, mode: 'a', enabled: true,
    })).toEqual([]);
  });

  it('flags missing required keys', () => {
    const errs = validateConfig(schema, {});
    expect(errs.some(e => e.key === 'url')).toBe(true);
  });

  it('flags type mismatch', () => {
    const errs = validateConfig(schema, { url: 'x', count: 'not-a-number' as unknown });
    expect(errs.some(e => e.key === 'count')).toBe(true);
  });

  it('flags enum mismatch', () => {
    const errs = validateConfig(schema, { url: 'x', mode: 'c' });
    expect(errs.some(e => e.key === 'mode')).toBe(true);
  });

  it('flags minimum/maximum violation', () => {
    const errs = validateConfig(schema, { url: 'x', count: 99 });
    expect(errs.some(e => e.key === 'count' && /max/i.test(e.message))).toBe(true);
  });

  it('flags minLength violation', () => {
    const errs = validateConfig(schema, { url: '' });
    expect(errs.some(e => e.key === 'url')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-schema-validator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `schemaValidator.ts`**

```ts
import Ajv, { ErrorObject } from 'ajv';
import type { ConfigurationContribution } from '../manifest';
import type { ConfigValueError } from './types';

const ajv = new Ajv({ allErrors: true, strict: false });

function compile(schema: ConfigurationContribution) {
  return ajv.compile({
    type: 'object',
    properties: schema.properties as Record<string, unknown>,
    required: schema.required ?? [],
    additionalProperties: true,
  });
}

const cache = new WeakMap<ConfigurationContribution, ReturnType<typeof compile>>();

function compiledFor(schema: ConfigurationContribution) {
  let c = cache.get(schema);
  if (!c) { c = compile(schema); cache.set(schema, c); }
  return c;
}

export function validateConfig(
  schema: ConfigurationContribution,
  values: Record<string, unknown>,
): ConfigValueError[] {
  const c = compiledFor(schema);
  if (c(values)) return [];
  return (c.errors ?? []).map(formatError);
}

function formatError(e: ErrorObject): ConfigValueError {
  if (e.keyword === 'required') {
    return { key: (e.params as { missingProperty: string }).missingProperty,
             message: 'is required' };
  }
  const key = e.instancePath.replace(/^\//, '') || '/';
  return { key, message: e.message ?? 'invalid' };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-schema-validator.test.ts`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/config/types.ts src/plugins/config/schemaValidator.ts src/__tests__/plugins-config-schema-validator.test.ts
git commit -m "feat(plugins): schemaValidator for per-value config validation"
```

---

### Task 3: KeychainBackend interface + InMemoryKeychainBackend

**Files:**
- Create: `src/plugins/config/keychainBackend.ts`
- Test: `src/__tests__/plugins-config-keychain-inmemory.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';

describe('InMemoryKeychainBackend', () => {
  it('returns undefined for missing key', async () => {
    const kb = new InMemoryKeychainBackend();
    expect(await kb.get('x')).toBeUndefined();
  });

  it('round-trips set and get', async () => {
    const kb = new InMemoryKeychainBackend();
    await kb.set('x', 'value');
    expect(await kb.get('x')).toBe('value');
  });

  it('overwrites on second set', async () => {
    const kb = new InMemoryKeychainBackend();
    await kb.set('x', 'a');
    await kb.set('x', 'b');
    expect(await kb.get('x')).toBe('b');
  });

  it('deletes a key', async () => {
    const kb = new InMemoryKeychainBackend();
    await kb.set('x', 'a');
    await kb.delete('x');
    expect(await kb.get('x')).toBeUndefined();
  });

  it('delete is idempotent on missing key', async () => {
    const kb = new InMemoryKeychainBackend();
    await expect(kb.delete('nope')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-keychain-inmemory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `keychainBackend.ts`**

```ts
export interface KeychainBackend {
  get(namespace: string): Promise<string | undefined>;
  set(namespace: string, value: string): Promise<void>;
  delete(namespace: string): Promise<void>;
}

export class KeychainLockedError extends Error {
  constructor(message = 'Keychain is locked') {
    super(message);
    this.name = 'KeychainLockedError';
  }
}

export class InMemoryKeychainBackend implements KeychainBackend {
  private store = new Map<string, string>();
  async get(ns: string)            { return this.store.get(ns); }
  async set(ns: string, v: string) { this.store.set(ns, v); }
  async delete(ns: string)         { this.store.delete(ns); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-keychain-inmemory.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/config/keychainBackend.ts src/__tests__/plugins-config-keychain-inmemory.test.ts
git commit -m "feat(plugins): KeychainBackend interface + InMemoryKeychainBackend"
```

---

### Task 4: Tauri command wrappers for plugin secrets

**Files:**
- Create: `src-tauri/src/commands/plugin_secrets.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/commands/mod.rs` (or whatever currently aggregates commands — confirm via `ls src-tauri/src/commands/`)

This task has no vitest tests; verification is `cargo check` and a manual smoke. The Rust API surface (`set_password / get_password / delete_password`) is already implemented in `src-tauri/src/keychain.rs:405-460`. We add thin Tauri command wrappers under a separate namespace so plugin secrets are clearly distinct from connection passwords.

- [ ] **Step 1: Inspect existing command registration**

Run: `ls src-tauri/src/commands/ && grep -n "set_ai_token" src-tauri/src/commands/ai.rs | head -5`
Expected: command modules listed; `set_ai_token` is a `#[tauri::command]`-annotated function. Copy that pattern.

- [ ] **Step 2: Create `src-tauri/src/commands/plugin_secrets.rs`**

```rust
use crate::keychain;
use crate::logging::Logger;
use std::sync::Arc;

#[tauri::command]
pub fn set_plugin_secret(
    namespace: String,
    value: String,
    log: tauri::State<Arc<dyn Logger>>,
) -> Result<(), String> {
    keychain::set_password(&namespace, &value, log.inner().as_ref())
}

#[tauri::command]
pub fn get_plugin_secret(
    namespace: String,
    log: tauri::State<Arc<dyn Logger>>,
) -> Result<Option<String>, String> {
    keychain::get_password(&namespace, log.inner().as_ref())
}

#[tauri::command]
pub fn delete_plugin_secret(
    namespace: String,
    log: tauri::State<Arc<dyn Logger>>,
) -> Result<(), String> {
    keychain::delete_password(&namespace, log.inner().as_ref())
}
```

Confirm the `Logger` import path and `State` shape match how `commands/ai.rs::set_ai_token` is implemented; copy that file's preamble exactly if it differs.

- [ ] **Step 3: Register the module in `src-tauri/src/commands/mod.rs`**

Add line: `pub mod plugin_secrets;`

- [ ] **Step 4: Register the commands in `src-tauri/src/main.rs`**

In the `invoke_handler` macro list (near the existing `commands::ai::set_ai_token` lines), append:

```
commands::plugin_secrets::set_plugin_secret,
commands::plugin_secrets::get_plugin_secret,
commands::plugin_secrets::delete_plugin_secret,
```

- [ ] **Step 5: Build Rust side**

Run: `cd src-tauri && cargo check && cd ..`
Expected: no errors.

If `cargo check` complains about unresolved imports, the closest reference implementation is `src-tauri/src/commands/ai.rs`. Match its imports verbatim.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/plugin_secrets.rs src-tauri/src/commands/mod.rs src-tauri/src/main.rs
git commit -m "feat(plugins): Tauri commands for plugin secret keychain access"
```

---

### Task 5: TauriKeychainBackend (TS-side wrapper)

**Files:**
- Create: `src/plugins/config/keychainBackend.tauri.ts`
- Test: `src/__tests__/plugins-config-keychain-tauri.test.ts`

- [ ] **Step 1: Write failing tests with mocked `@tauri-apps/api/core`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { TauriKeychainBackend } from '../plugins/config/keychainBackend.tauri';

beforeEach(() => { invoke.mockReset(); });

describe('TauriKeychainBackend', () => {
  it('get returns undefined when underlying returns null', async () => {
    invoke.mockResolvedValueOnce(null);
    const kb = new TauriKeychainBackend();
    expect(await kb.get('ns')).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('get_plugin_secret', { namespace: 'ns' });
  });

  it('get returns the string when underlying returns a string', async () => {
    invoke.mockResolvedValueOnce('hello');
    const kb = new TauriKeychainBackend();
    expect(await kb.get('ns')).toBe('hello');
  });

  it('set invokes set_plugin_secret with namespace and value', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const kb = new TauriKeychainBackend();
    await kb.set('ns', 'v');
    expect(invoke).toHaveBeenCalledWith('set_plugin_secret', { namespace: 'ns', value: 'v' });
  });

  it('delete invokes delete_plugin_secret', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const kb = new TauriKeychainBackend();
    await kb.delete('ns');
    expect(invoke).toHaveBeenCalledWith('delete_plugin_secret', { namespace: 'ns' });
  });

  it('wraps "locked" errors in KeychainLockedError', async () => {
    invoke.mockRejectedValueOnce('keychain locked: master key unavailable');
    const kb = new TauriKeychainBackend();
    await expect(kb.set('ns', 'v')).rejects.toThrow(/locked/i);
    await expect(kb.set('ns', 'v').catch(e => e.name)).resolves.toBe('KeychainLockedError');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-keychain-tauri.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `keychainBackend.tauri.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';
import { KeychainBackend, KeychainLockedError } from './keychainBackend';

export class TauriKeychainBackend implements KeychainBackend {
  async get(namespace: string): Promise<string | undefined> {
    try {
      const v = await invoke<string | null>('get_plugin_secret', { namespace });
      return v === null ? undefined : v;
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async set(namespace: string, value: string): Promise<void> {
    try {
      await invoke<void>('set_plugin_secret', { namespace, value });
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async delete(namespace: string): Promise<void> {
    try {
      await invoke<void>('delete_plugin_secret', { namespace });
    } catch (e) {
      throw this.wrap(e);
    }
  }

  private wrap(e: unknown): Error {
    const msg = e instanceof Error ? e.message : String(e);
    if (/locked|unavailable|denied/i.test(msg)) return new KeychainLockedError(msg);
    return e instanceof Error ? e : new Error(msg);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-keychain-tauri.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/config/keychainBackend.tauri.ts src/__tests__/plugins-config-keychain-tauri.test.ts
git commit -m "feat(plugins): TauriKeychainBackend wrapper over Rust keychain commands"
```

---

### Task 6: Refactor `InMemorySecretStorage` to wrap `KeychainBackend`

**Files:**
- Modify: `src/plugins/api/secretStorage.ts`

The goal is one keychain seam app-wide with two consumers (config + runtime secrets) using distinct namespaces. The existing `SecretStorage` interface stays — only the in-memory implementation changes.

- [ ] **Step 1: Read the current file**

Run: `cat src/plugins/api/secretStorage.ts`
Expected: contains a `SecretStorage` interface and an `InMemorySecretStorage` class with a Map.

- [ ] **Step 2: Refactor `InMemorySecretStorage` to delegate to `KeychainBackend`**

Replace the body of `InMemorySecretStorage` with:

```ts
import { KeychainBackend, InMemoryKeychainBackend } from '../config/keychainBackend';

export class InMemorySecretStorage implements SecretStorage {
  constructor(private readonly backend: KeychainBackend = new InMemoryKeychainBackend()) {}
  async get(key: string)              { return this.backend.get(key); }
  async store(key: string, v: string) { return this.backend.set(key, v); }
  async delete(key: string)           { return this.backend.delete(key); }
}
```

Keep the `SecretStorage` interface and `namespaceFor` helper exactly as they are. The `namespaceFor(pluginId, key)` function already produces `plugin:<pluginId>:<key>`; update it to `plugin:<pluginId>:secret:<key>` so it doesn't collide with the upcoming `plugin:<pluginId>:config:<key>` namespace used by `ConfigStore`.

- [ ] **Step 3: Run the existing secret-storage tests**

Run: `npx vitest run src/__tests__/plugins-secret-storage.test.ts`
Expected: all passing.

If a test inspects the literal namespace shape (rare), update its expectation to match `plugin:<id>:secret:<key>`.

- [ ] **Step 4: Run the broader manager/host suite for regressions**

Run: `npx vitest run src/__tests__/plugins-manager-activate.test.ts src/__tests__/plugins-host-services.test.ts`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/api/secretStorage.ts src/__tests__/plugins-secret-storage.test.ts
git commit -m "refactor(plugins): InMemorySecretStorage delegates to KeychainBackend; namespace secrets"
```

---

### Task 7: ConfigStore — routing + atomic setMany

**Files:**
- Create: `src/plugins/config/ConfigStore.ts`
- Test: `src/__tests__/plugins-config-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend, KeychainLockedError } from '../plugins/config/keychainBackend';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string)        { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    apiUrl:   { type: 'string', default: 'http://default' },
    password: { type: 'string', 'x-secret': true },
    timeout:  { type: 'integer', default: 30 },
  },
  required: ['apiUrl'],
};

function make() {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('acme.foo', schema, ws as any, kb);
  return { ws, kb, store };
}

describe('ConfigStore', () => {
  it('returns schema defaults when nothing stored', async () => {
    const { store } = make();
    expect(await store.getAll()).toEqual({ apiUrl: 'http://default', password: undefined, timeout: 30 });
  });

  it('routes x-secret writes to keychain', async () => {
    const { kb, store } = make();
    await store.setMany({ password: 'pw' });
    expect(await kb.get('plugin:acme.foo:config:password')).toBe('pw');
  });

  it('routes plain writes to workspace', async () => {
    const { ws, store } = make();
    await store.setMany({ apiUrl: 'http://x' });
    expect(ws.store.get('plugin.acme.foo.config.apiUrl')).toBe('http://x');
  });

  it('namespaces do not collide between config and secrets', async () => {
    const { kb } = make();
    await kb.set('plugin:acme.foo:secret:token', 'runtime');
    await kb.set('plugin:acme.foo:config:password', 'configured');
    expect(await kb.get('plugin:acme.foo:secret:token')).toBe('runtime');
    expect(await kb.get('plugin:acme.foo:config:password')).toBe('configured');
  });

  it('setMany is atomic when keychain throws', async () => {
    const { ws, store, kb } = make();
    kb.set = async () => { throw new KeychainLockedError(); };
    await expect(store.setMany({ apiUrl: 'http://x', password: 'pw' }))
      .rejects.toThrow(KeychainLockedError);
    expect(ws.store.get('plugin.acme.foo.config.apiUrl')).toBeUndefined();
  });

  it('setMany returns only keys that actually changed', async () => {
    const { store } = make();
    await store.setMany({ apiUrl: 'http://x' });
    const changed = await store.setMany({ apiUrl: 'http://x', timeout: 60 });
    expect(changed.sort()).toEqual(['timeout']);
  });

  it('returns stored value over default', async () => {
    const { store } = make();
    await store.setMany({ apiUrl: 'http://saved' });
    expect((await store.getAll()).apiUrl).toBe('http://saved');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ConfigStore.ts`**

```ts
import type { ConfigurationContribution, JSONSchemaProperty } from '../manifest';
import type { KeychainBackend } from './keychainBackend';

export interface WorkspaceLike {
  get(key: string): Promise<unknown>;
  update(key: string, value: unknown): Promise<void>;
}

export class ConfigStore {
  constructor(
    private readonly pluginId: string,
    private readonly schema: ConfigurationContribution,
    private readonly workspace: WorkspaceLike,
    private readonly keychain: KeychainBackend,
  ) {}

  async getAll(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(this.schema.properties)) {
      out[key] = await this.getOne(key, prop);
    }
    return out;
  }

  async getOne(key: string, prop?: JSONSchemaProperty): Promise<unknown> {
    const p = prop ?? this.schema.properties[key];
    if (!p) return undefined;
    if (this.isSecret(p)) {
      const v = await this.keychain.get(this.secretNs(key));
      return v ?? p.default;
    }
    const v = await this.workspace.get(this.plainNs(key));
    return v === undefined ? p.default : v;
  }

  /** Writes all values atomically; returns keys whose stored value differs from before. */
  async setMany(values: Record<string, unknown>): Promise<string[]> {
    const before: Record<string, unknown> = {};
    const secretWrites: Array<[string, string]> = [];
    const plainWrites:  Array<[string, unknown]> = [];

    for (const [key, value] of Object.entries(values)) {
      const prop = this.schema.properties[key];
      if (!prop) continue;
      before[key] = await this.getOne(key, prop);
      if (this.isSecret(prop)) {
        secretWrites.push([this.secretNs(key), String(value ?? '')]);
      } else {
        plainWrites.push([this.plainNs(key), value]);
      }
    }

    // Secrets first — if keychain throws, no plain writes happen.
    for (const [ns, v] of secretWrites) await this.keychain.set(ns, v);
    for (const [ns, v] of plainWrites)  await this.workspace.update(ns, v);

    const changed: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (this.schema.properties[key] && before[key] !== value) changed.push(key);
    }
    return changed;
  }

  private isSecret(p: JSONSchemaProperty): boolean {
    return p.type === 'string' && p['x-secret'] === true;
  }
  private secretNs(key: string): string { return `plugin:${this.pluginId}:config:${key}`; }
  private plainNs(key: string):  string { return `plugin.${this.pluginId}.config.${key}`; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-store.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/config/ConfigStore.ts src/__tests__/plugins-config-store.test.ts
git commit -m "feat(plugins): ConfigStore with x-secret routing + atomic setMany"
```

---

### Task 8: ConfigService — get/set/save/onDidChange

**Files:**
- Create: `src/plugins/config/ConfigService.ts`
- Create: `src/plugins/config/index.ts`
- Test: `src/__tests__/plugins-config-service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    url:     { type: 'string', default: 'http://d' },
    secret:  { type: 'string', 'x-secret': true },
    timeout: { type: 'integer', minimum: 0, maximum: 100 },
  },
  required: ['url'],
};

function make(opts: { grantSecretsRead?: boolean; manager?: { recheckEnforcement: ReturnType<typeof vi.fn> } } = {}) {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('p', schema, ws as any, kb);
  const broker = new PermissionBroker();
  if (opts.grantSecretsRead) broker.setGrants('p', [{ kind: 'secrets:read' }]);
  const manager = opts.manager ?? { recheckEnforcement: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new ConfigService('p', schema, store, broker, manager as any);
  return { ws, kb, store, broker, manager, svc };
}

describe('ConfigService.get / getAll', () => {
  it('returns defaults when unset', async () => {
    const { svc } = make();
    expect(await svc.get('url')).toBe('http://d');
  });

  it('omits x-secret values when secrets:read not granted', async () => {
    const { svc, kb } = make();
    await kb.set('plugin:p:config:secret', 'hidden');
    expect(await svc.get('secret')).toBeUndefined();
  });

  it('returns x-secret values when secrets:read is granted', async () => {
    const { svc, kb } = make({ grantSecretsRead: true });
    await kb.set('plugin:p:config:secret', 'visible');
    expect(await svc.get('secret')).toBe('visible');
  });

  it('getAll omits secret keys without secrets:read', async () => {
    const { svc, kb } = make();
    await kb.set('plugin:p:config:secret', 'hidden');
    const all = await svc.getAll();
    expect(all.secret).toBeUndefined();
    expect(all.url).toBe('http://d');
  });
});

describe('ConfigService.set', () => {
  it('validates and writes', async () => {
    const { svc, ws } = make();
    await svc.set('url', 'http://new');
    expect(ws.store.get('plugin.p.config.url')).toBe('http://new');
  });

  it('throws on schema violation', async () => {
    const { svc } = make();
    await expect(svc.set('timeout', 9999)).rejects.toThrow();
  });

  it('fires onDidChange with single-key delta', async () => {
    const { svc } = make();
    const seen: Array<{ keys: string[] }> = [];
    svc.onDidChange(e => seen.push({ keys: e.keys }));
    await svc.set('url', 'http://x');
    expect(seen).toEqual([{ keys: ['url'] }]);
  });
});

describe('ConfigService.save (batched)', () => {
  it('fires onDidChange once with only changed keys', async () => {
    const { svc } = make();
    await svc.set('url', 'http://x'); // baseline
    const events: string[][] = [];
    svc.onDidChange(e => events.push(e.keys.sort()));
    await svc.save({ url: 'http://x', timeout: 50 });   // url unchanged, timeout new
    expect(events).toEqual([['timeout']]);
  });

  it('does not fire onDidChange when nothing changed', async () => {
    const { svc } = make();
    await svc.set('url', 'http://x');
    const fn = vi.fn();
    svc.onDidChange(fn);
    await svc.save({ url: 'http://x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls manager.recheckEnforcement after a successful save', async () => {
    const recheck = vi.fn();
    const { svc } = make({ manager: { recheckEnforcement: recheck } });
    await svc.save({ url: 'http://x' });
    expect(recheck).toHaveBeenCalledWith('p');
  });

  it('serializes concurrent saves', async () => {
    const { svc, ws } = make();
    await Promise.all([
      svc.save({ url: 'http://a' }),
      svc.save({ url: 'http://b' }),
    ]);
    // Second save wins; both completed without interleaving (no thrown errors).
    expect(['http://a', 'http://b']).toContain(ws.store.get('plugin.p.config.url'));
  });

  it('omits secrets from the event payload when listener lacks secrets:read', async () => {
    const { svc } = make();
    const seen: Array<Record<string, unknown>> = [];
    svc.onDidChange(e => seen.push(e.values));
    await svc.save({ url: 'http://x', secret: 'pw' });
    expect(seen[0].url).toBe('http://x');
    expect(seen[0].secret).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ConfigService.ts`**

```ts
import type { ConfigurationContribution, JSONSchemaProperty } from '../manifest';
import { validateConfig } from './schemaValidator';
import { ConfigStore } from './ConfigStore';
import type { PermissionBroker } from '../PermissionBroker';
import type { ConfigChangeEvent, Disposable } from './types';

interface ManagerLike {
  recheckEnforcement(pluginId: string): Promise<void> | void;
}

export class ConfigService {
  private listeners = new Set<(e: ConfigChangeEvent) => void>();
  private saveQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pluginId: string,
    private readonly schema: ConfigurationContribution,
    private readonly store: ConfigStore,
    private readonly broker: PermissionBroker,
    private readonly manager: ManagerLike,
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const prop = this.schema.properties[key];
    if (!prop) return undefined;
    if (this.isSecret(prop) && !this.hasSecretsRead()) return undefined;
    return (await this.store.getOne(key)) as T | undefined;
  }

  async getAll(): Promise<Record<string, unknown>> {
    const all = await this.store.getAll();
    if (this.hasSecretsRead()) return all;
    return this.stripSecrets(all);
  }

  async set(key: string, value: unknown): Promise<void> {
    const next = { ...(await this.store.getAll()), [key]: value };
    const errs = validateConfig(this.schema, next);
    if (errs.length) {
      throw new Error(`Config validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`);
    }
    await this.store.setMany({ [key]: value });
    this.fire([key], { [key]: value });
  }

  save(values: Record<string, unknown>): Promise<void> {
    const job = this.saveQueue.then(async () => {
      const errs = validateConfig(this.schema, values);
      if (errs.length) {
        throw new Error(`Config validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`);
      }
      const changedKeys = await this.store.setMany(values);
      if (changedKeys.length > 0) {
        const payload: Record<string, unknown> = {};
        for (const k of changedKeys) payload[k] = values[k];
        this.fire(changedKeys, payload);
      }
      await this.manager.recheckEnforcement(this.pluginId);
    });
    this.saveQueue = job.catch(() => undefined);
    return job;
  }

  onDidChange(listener: (e: ConfigChangeEvent) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private isSecret(p: JSONSchemaProperty): boolean {
    return p.type === 'string' && p['x-secret'] === true;
  }
  private hasSecretsRead(): boolean {
    try {
      this.broker.check(this.pluginId, { kind: 'secrets:read' });
      return true;
    } catch { return false; }
  }
  private stripSecrets(values: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      const p = this.schema.properties[k];
      if (p && this.isSecret(p)) continue;
      out[k] = v;
    }
    return out;
  }
  private fire(keys: string[], values: Record<string, unknown>) {
    const filtered = this.hasSecretsRead() ? values : this.stripSecrets(values);
    const event: ConfigChangeEvent = { keys, values: filtered };
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore listener errors */ }
    }
  }
}
```

- [ ] **Step 4: Create `src/plugins/config/index.ts`**

```ts
export * from './types';
export { validateConfig } from './schemaValidator';
export { KeychainBackend, InMemoryKeychainBackend, KeychainLockedError } from './keychainBackend';
export { TauriKeychainBackend } from './keychainBackend.tauri';
export { ConfigStore } from './ConfigStore';
export type { WorkspaceLike } from './ConfigStore';
export { ConfigService } from './ConfigService';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-service.test.ts`
Expected: 11 passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/config/ConfigService.ts src/plugins/config/index.ts src/__tests__/plugins-config-service.test.ts
git commit -m "feat(plugins): ConfigService with batched save + secrets-gated events"
```

---

### Task 9: Extend RuleContext with workspace + keychain

**Files:**
- Modify: `src/plugins/enforcement/types.ts`

- [ ] **Step 1: Add optional fields to `RuleContext`**

Replace the `RuleContext` interface in `src/plugins/enforcement/types.ts` with:

```ts
import type { PluginManifest } from '../manifest';
import type { PluginFs } from '../io';
import type { KeychainBackend, WorkspaceLike } from '../config';

export interface RuleContext {
  pluginDir: string;
  manifest: PluginManifest;
  fs: PluginFs;
  workspace?: WorkspaceLike;
  keychain?: KeychainBackend;
}
```

Both new fields are optional so the existing README rule and existing tests continue to compile unchanged.

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run existing enforcement tests**

Run: `npx vitest run src/__tests__/plugins-enforcement-registry.test.ts src/__tests__/plugins-enforcement-readme-rule.test.ts src/__tests__/plugins-manager-enforcement.test.ts`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/enforcement/types.ts
git commit -m "feat(plugins): RuleContext gains optional workspace + keychain"
```

---

### Task 10: requiredConfigRule + register in defaultEnforcementRegistry

**Files:**
- Create: `src/plugins/enforcement/rules/requiredConfig.ts`
- Modify: `src/plugins/enforcement/index.ts`
- Test: `src/__tests__/plugins-enforcement-required-config-rule.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { requiredConfigRule } from '../plugins/enforcement/rules/requiredConfig';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import type { RuleContext } from '../plugins/enforcement/types';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

function ctx(manifestOver: Record<string, unknown> = {}, wsValues: Record<string, unknown> = {}, kbValues: Record<string, string> = {}): RuleContext {
  const ws = new FakeWorkspace();
  for (const [k, v] of Object.entries(wsValues)) ws.store.set(k, v);
  const kb = new InMemoryKeychainBackend();
  for (const [k, v] of Object.entries(kbValues)) kb.set(k, v);
  return {
    pluginDir: '/p',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifest: {
      id: 'p', name: 'P', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'm.js',
      contributes: {
        configuration: {
          title: 'P',
          properties: {
            url:      { type: 'string' },
            password: { type: 'string', 'x-secret': true },
          },
          required: ['url', 'password'],
        },
      },
      ...manifestOver,
    } as any,
    fs: {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workspace: ws as any,
    keychain: kb,
  };
}

describe('requiredConfigRule', () => {
  it('returns no findings when manifest has no configuration block', async () => {
    const c = ctx({ contributes: {} });
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });

  it('returns no findings when no required keys', async () => {
    const c = ctx({ contributes: { configuration: { title: 'X', properties: { url: { type: 'string' } } } } });
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });

  it('warning when required missing and requireConfig is absent', async () => {
    const c = ctx();
    const findings = await requiredConfigRule.check(c);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/url.*password|password.*url/);
  });

  it('error when required missing and requireConfig is true', async () => {
    const c = ctx({ activation: { requireConfig: true } });
    const findings = await requiredConfigRule.check(c);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('no findings when all required values are set', async () => {
    const c = ctx(
      { activation: { requireConfig: true } },
      { 'plugin.p.config.url': 'http://x' },
      { 'plugin:p:config:password': 'pw' },
    );
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });

  it('no findings when workspace + keychain are absent (no-op)', async () => {
    const c = ctx();
    c.workspace = undefined;
    c.keychain = undefined;
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-enforcement-required-config-rule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `requiredConfigRule`**

```ts
import type { Rule } from '../types';
import { ConfigStore } from '../../config/ConfigStore';

const RULE_ID = 'core.required-config';

export const requiredConfigRule: Rule = {
  id: RULE_ID,
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
      ruleId: RULE_ID,
      severity: blocking ? 'error' : 'warning',
      message: `Required configuration missing: ${missing.join(', ')}`,
      fixHint: "Open the Settings section on this plugin's detail pane and fill in the highlighted fields.",
    }];
  },
};
```

- [ ] **Step 4: Register in `src/plugins/enforcement/index.ts`**

Add the import and registration call. After the existing `defaultEnforcementRegistry.register(readmePresentRule);` line, add:

```ts
import { requiredConfigRule } from './rules/requiredConfig';
// ...
defaultEnforcementRegistry.register(requiredConfigRule);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-enforcement-required-config-rule.test.ts`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/enforcement/rules/requiredConfig.ts src/plugins/enforcement/index.ts src/__tests__/plugins-enforcement-required-config-rule.test.ts
git commit -m "feat(plugins): requiredConfigRule + register in default registry"
```

---

### Task 11: PluginManager wires ConfigService + recheckEnforcement

**Files:**
- Modify: `src/plugins/PluginManager.ts`
- Test: `src/__tests__/plugins-manager-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { EnforcementRegistry } from '../plugins/enforcement/EnforcementRegistry';
import { requiredConfigRule } from '../plugins/enforcement/rules/requiredConfig';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string)        { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const MANIFEST = {
  id: 'p', name: 'P', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'm.js',
  activation: { requireConfig: true },
  contributes: {
    configuration: {
      title: 'P',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
};

function makeMgr(workspace = new FakeWorkspace(), keychain = new InMemoryKeychainBackend()) {
  const enforcement = new EnforcementRegistry();
  enforcement.register(requiredConfigRule);
  return new PluginManager({
    registries: createRegistrySet(),
    broker: new PermissionBroker(),
    hostApiVersion: '1.0.0',
    logger: silentLogger(),
    fs: {
      listPluginDirs: async () => ['/plugins/p'],
      readManifest:    async () => JSON.stringify(MANIFEST),
      readEntry:       async () => 'export function activate(){}',
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
    enforcement,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workspace: workspace as any,
    keychain,
  });
}

describe('PluginManager config integration', () => {
  it('passes workspace + keychain into RuleContext (required-config gate fires)', async () => {
    const mgr = makeMgr();
    await mgr.discover();
    const rec = mgr.get('p')!;
    expect(rec.findings.some(f => f.ruleId === 'core.required-config' && f.severity === 'error')).toBe(true);
  });

  it('recheckEnforcement reruns rules and updates findings', async () => {
    const ws = new FakeWorkspace();
    const mgr = makeMgr(ws);
    await mgr.discover();
    expect(mgr.get('p')!.findings).toHaveLength(1);
    ws.store.set('plugin.p.config.url', 'http://x');
    await mgr.recheckEnforcement('p');
    expect(mgr.get('p')!.findings).toEqual([]);
  });

  it('recheckEnforcement is a no-op for unknown id', async () => {
    const mgr = makeMgr();
    await expect(mgr.recheckEnforcement('does-not-exist')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-manager-config.test.ts`
Expected: FAIL — `workspace`/`keychain` options unknown to `PluginManager`; `recheckEnforcement` not exported.

- [ ] **Step 3: Add `workspace` + `keychain` options and `recheckEnforcement` method**

In `src/plugins/PluginManager.ts`:

3a. Add imports near the existing config imports:

```ts
import type { KeychainBackend, WorkspaceLike } from './config';
```

3b. Extend `ManagerOptions`:

```ts
interface ManagerOptions {
  // ...existing fields unchanged...
  workspace?: WorkspaceLike;
  keychain?: KeychainBackend;
}
```

3c. In `loadOne`, when calling `enforcementRegistry.runAll`, pass the new fields:

```ts
const findings = await this.enforcement.runAll({
  pluginDir: dir,
  manifest: v.manifest,
  fs: this.opts.fs,
  workspace: this.opts.workspace,
  keychain: this.opts.keychain,
});
```

3d. Add a public method on the class:

```ts
async recheckEnforcement(pluginId: string): Promise<void> {
  const rec = this.records.get(pluginId);
  if (!rec || !rec.manifest) return;
  rec.findings = await this.enforcement.runAll({
    pluginDir: rec.dir,
    manifest: rec.manifest,
    fs: this.opts.fs,
    workspace: this.opts.workspace,
    keychain: this.opts.keychain,
  });
}
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-manager-config.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Full plugin suite regression**

Run: `npx vitest run src/__tests__/`
Expected: all passing. If any older manager test breaks because it now sees a `core.required-config` finding (the registry now includes it via `defaultEnforcementRegistry`), inspect the test — those tests typically pass a custom EnforcementRegistry that does NOT include the new rule, so most should be fine. If a test using `defaultEnforcementRegistry` breaks, update its expectation to include the new rule's no-op output (when no config block exists, the rule returns `[]`).

- [ ] **Step 6: Commit**

```bash
git add src/plugins/PluginManager.ts src/__tests__/plugins-manager-config.test.ts
git commit -m "feat(plugins): wire workspace + keychain into PluginManager; add recheckEnforcement"
```

---

### Task 12: Expose `mongolens.config` in createMongolens

**Files:**
- Modify: `src/plugins/api/createMongolens.ts`
- Modify: `src/plugins/hostServices.ts` (extend `HostServices` shape to include `config`)
- Test: `src/__tests__/plugins-mongolens-config-api.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createMongolens } from '../plugins/api/createMongolens';
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { createRegistrySet } from '../plugins/registries';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'P',
  properties: { url: { type: 'string', default: 'http://d' } },
};

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('mongolens.config (createMongolens)', () => {
  it('exposes get/set/getAll/onDidChange', async () => {
    const ws = new FakeWorkspace();
    const kb = new InMemoryKeychainBackend();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new ConfigStore('p', schema, ws as any, kb);
    const broker = new PermissionBroker();
    const config = new ConfigService('p', schema, store, broker,
      { recheckEnforcement: vi.fn() });

    const ml = createMongolens({
      pluginId: 'p',
      registries: createRegistrySet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: { config } as any,
      logger: silentLogger(),
      manifest: { id: 'p', name: 'P', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'm.js' },
    });

    expect(typeof ml.config.get).toBe('function');
    expect(typeof ml.config.set).toBe('function');
    expect(typeof ml.config.getAll).toBe('function');
    expect(typeof ml.config.onDidChange).toBe('function');
    expect(await ml.config.get('url')).toBe('http://d');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-mongolens-config-api.test.ts`
Expected: FAIL — `ml.config` is undefined.

- [ ] **Step 3: Add `config` to `HostServices` shape**

In `src/plugins/hostServices.ts`, extend the `HostServices` interface to include:

```ts
config?: {
  get<T = unknown>(key: string): Promise<T | undefined>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  onDidChange(listener: (e: import('./config').ConfigChangeEvent) => void): { dispose(): void };
};
```

Marked optional (`?`) so plugins without a configuration block don't construct a ConfigService.

- [ ] **Step 4: Expose `config` from `createMongolens`**

In `src/plugins/api/createMongolens.ts`, where the returned `MongolensAPI` object is constructed, add `config: services.config` (or a no-op stub if `services.config` is absent, so plugin code never crashes on `.get`). Use this pattern:

```ts
return {
  // ...existing fields...
  config: services.config ?? {
    get:         async () => undefined,
    getAll:      async () => ({}),
    set:         async () => { throw new Error('Plugin has no contributes.configuration'); },
    onDidChange: () => ({ dispose() {} }),
  },
};
```

Also add `config:` to the `MongolensAPI` type definition in the same file with the same shape as the `HostServices.config` interface (non-optional on the public API).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-mongolens-config-api.test.ts`
Expected: 1 passing.

- [ ] **Step 6: Run full suite regression**

Run: `npx vitest run src/__tests__/`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/api/createMongolens.ts src/plugins/hostServices.ts src/__tests__/plugins-mongolens-config-api.test.ts
git commit -m "feat(plugins): expose mongolens.config (get/set/getAll/onDidChange)"
```

---

### Task 13: FieldRenderer types + registry

**Files:**
- Create: `src/plugins/config/fieldRenderers/index.ts`
- Test: `src/__tests__/plugins-config-field-renderer-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { FieldRendererRegistry } from '../plugins/config/fieldRenderers';
import type { FieldRenderer } from '../plugins/config/fieldRenderers';

const make = (id: string, match: (s: { type: string; format?: string }) => boolean): FieldRenderer => ({
  matches: (s) => match(s as { type: string; format?: string }),
  // eslint-disable-next-line react/jsx-key
  render: () => <span data-id={id} />,
});

describe('FieldRendererRegistry', () => {
  it('returns first matcher in registration order', () => {
    const reg = new FieldRendererRegistry();
    reg.register(make('A', s => s.type === 'string'));
    reg.register(make('B', s => s.type === 'string'));
    const r = reg.find({ type: 'string' });
    expect(r).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r!.render({} as any) as any).props['data-id']).toBe('A');
  });

  it('returns undefined when nothing matches', () => {
    const reg = new FieldRendererRegistry();
    expect(reg.find({ type: 'string' })).toBeUndefined();
  });

  it('matcher priority lets custom renderer beat default', () => {
    const reg = new FieldRendererRegistry();
    reg.register(make('date', s => s.type === 'string' && s.format === 'date'));
    reg.register(make('string', s => s.type === 'string'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reg.find({ type: 'string', format: 'date' })!.render({} as any) as any).props['data-id']).toBe('date');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reg.find({ type: 'string' })!.render({} as any) as any).props['data-id']).toBe('string');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-field-renderer-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement registry**

```tsx
import { ReactNode } from 'react';
import type { JSONSchemaProperty } from '../../manifest';

export interface FieldRendererProps {
  schema: JSONSchemaProperty;
  value: unknown;
  error?: string;
  onCommit(value: unknown): void;
}

export interface FieldRenderer {
  matches(schema: JSONSchemaProperty): boolean;
  render(props: FieldRendererProps): ReactNode;
}

export class FieldRendererRegistry {
  private list: FieldRenderer[] = [];
  register(r: FieldRenderer): void { this.list.push(r); }
  find(schema: JSONSchemaProperty): FieldRenderer | undefined {
    return this.list.find(r => r.matches(schema));
  }
  all(): readonly FieldRenderer[] { return this.list; }
}

export const defaultFieldRendererRegistry = new FieldRendererRegistry();
// Concrete registrations happen in Task 14–17.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-field-renderer-registry.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/config/fieldRenderers/index.ts src/__tests__/plugins-config-field-renderer-registry.test.ts
git commit -m "feat(plugins): FieldRendererRegistry with matcher-priority lookup"
```

---

### Task 14: StringField + NumberField + BooleanField

**Files:**
- Create: `src/plugins/config/fieldRenderers/StringField.tsx`
- Create: `src/plugins/config/fieldRenderers/NumberField.tsx`
- Create: `src/plugins/config/fieldRenderers/BooleanField.tsx`
- Modify: `src/plugins/config/fieldRenderers/index.ts` (register them — see Step 5)
- Test: `src/__tests__/plugins-config-primitive-fields.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { stringField, numberField, booleanField } from '../plugins/config/fieldRenderers';

describe('StringField', () => {
  it('renders an <input type="text"> for plain string', () => {
    const node = stringField.render({
      schema: { type: 'string' }, value: 'hello', onCommit: () => {},
    });
    render(<>{node}</>);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('hello');
  });

  it('renders <select> for string + enum', () => {
    const node = stringField.render({
      schema: { type: 'string', enum: ['a', 'b', 'c'] }, value: 'b', onCommit: () => {},
    });
    render(<>{node}</>);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('b');
    expect(Array.from(select.options).map(o => o.value)).toEqual(['a', 'b', 'c']);
  });

  it('commits value on blur for text', () => {
    const onCommit = vi.fn();
    const node = stringField.render({
      schema: { type: 'string' }, value: '', onCommit,
    });
    render(<>{node}</>);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'typed' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('typed');
  });
});

describe('NumberField', () => {
  it('renders an <input type="number">', () => {
    const node = numberField.render({
      schema: { type: 'integer' }, value: 5, onCommit: () => {},
    });
    render(<>{node}</>);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('5');
  });

  it('commits parsed number on blur', () => {
    const onCommit = vi.fn();
    const node = numberField.render({
      schema: { type: 'integer' }, value: 0, onCommit,
    });
    render(<>{node}</>);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(42);
  });
});

describe('BooleanField', () => {
  it('renders an <input type="checkbox">', () => {
    const node = booleanField.render({
      schema: { type: 'boolean' }, value: true, onCommit: () => {},
    });
    render(<>{node}</>);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it('commits on change (not blur)', () => {
    const onCommit = vi.fn();
    const node = booleanField.render({
      schema: { type: 'boolean' }, value: false, onCommit,
    });
    render(<>{node}</>);
    const cb = screen.getByRole('checkbox');
    fireEvent.click(cb);
    expect(onCommit).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-primitive-fields.test.tsx`
Expected: FAIL — `stringField`/`numberField`/`booleanField` not exported.

- [ ] **Step 3: Implement StringField**

```tsx
import { useState } from 'react';
import type { FieldRenderer } from './index';

export const stringField: FieldRenderer = {
  matches: (s) => s.type === 'string' && s['x-secret'] !== true,
  render: ({ schema, value, error, onCommit }) => {
    if (schema.enum) {
      return (
        <span>
          <select
            value={(value as string | undefined) ?? ''}
            onChange={(e) => onCommit(e.target.value)}
          >
            {schema.enum.map((opt) => (
              <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
            ))}
          </select>
          {error && <small className="field-error">{error}</small>}
        </span>
      );
    }
    return <StringInput value={value as string | undefined} onCommit={onCommit} error={error} />;
  },
};

function StringInput(p: { value: string | undefined; onCommit: (v: string) => void; error?: string }) {
  const [local, setLocal] = useState(p.value ?? '');
  return (
    <span>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => p.onCommit(local)}
      />
      {p.error && <small className="field-error">{p.error}</small>}
    </span>
  );
}
```

- [ ] **Step 4: Implement NumberField**

```tsx
import { useState } from 'react';
import type { FieldRenderer } from './index';

export const numberField: FieldRenderer = {
  matches: (s) => s.type === 'number' || s.type === 'integer',
  render: ({ schema, value, error, onCommit }) => (
    <NumberInput
      value={value as number | undefined}
      integer={schema.type === 'integer'}
      onCommit={onCommit}
      error={error}
      min={schema.minimum}
      max={schema.maximum}
    />
  ),
};

function NumberInput(p: {
  value: number | undefined; integer: boolean; onCommit: (v: number) => void;
  error?: string; min?: number; max?: number;
}) {
  const [local, setLocal] = useState(p.value === undefined ? '' : String(p.value));
  return (
    <span>
      <input
        type="number"
        value={local}
        min={p.min}
        max={p.max}
        step={p.integer ? 1 : 'any'}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = p.integer ? parseInt(local, 10) : parseFloat(local);
          if (!Number.isNaN(n)) p.onCommit(n);
        }}
      />
      {p.error && <small className="field-error">{p.error}</small>}
    </span>
  );
}
```

- [ ] **Step 5: Implement BooleanField + register all three**

`BooleanField.tsx`:

```tsx
import type { FieldRenderer } from './index';

export const booleanField: FieldRenderer = {
  matches: (s) => s.type === 'boolean',
  render: ({ value, error, onCommit }) => (
    <span>
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onCommit(e.target.checked)}
      />
      {error && <small className="field-error">{error}</small>}
    </span>
  ),
};
```

In `src/plugins/config/fieldRenderers/index.ts`, after the registry instance, add re-exports and registrations:

```ts
export { stringField } from './StringField';
export { numberField } from './NumberField';
export { booleanField } from './BooleanField';

import { stringField } from './StringField';
import { numberField } from './NumberField';
import { booleanField } from './BooleanField';

// Order matters: more-specific renderers register first.
defaultFieldRendererRegistry.register(numberField);
defaultFieldRendererRegistry.register(booleanField);
defaultFieldRendererRegistry.register(stringField);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-primitive-fields.test.tsx`
Expected: 7 passing.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/config/fieldRenderers/StringField.tsx src/plugins/config/fieldRenderers/NumberField.tsx src/plugins/config/fieldRenderers/BooleanField.tsx src/plugins/config/fieldRenderers/index.ts src/__tests__/plugins-config-primitive-fields.test.tsx
git commit -m "feat(plugins): StringField + NumberField + BooleanField renderers"
```

---

### Task 15: SecretField

**Files:**
- Create: `src/plugins/config/fieldRenderers/SecretField.tsx`
- Modify: `src/plugins/config/fieldRenderers/index.ts` (register)
- Test: `src/__tests__/plugins-config-secret-field.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { secretField } from '../plugins/config/fieldRenderers';

describe('SecretField', () => {
  it('matches string + x-secret:true', () => {
    expect(secretField.matches({ type: 'string', 'x-secret': true })).toBe(true);
    expect(secretField.matches({ type: 'string' })).toBe(false);
  });

  it('renders type="password" by default', () => {
    render(<>{secretField.render({
      schema: { type: 'string', 'x-secret': true },
      value: 'pw', onCommit: () => {},
    })}</>);
    const input = screen.getByLabelText(/secret value/i) as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('reveal toggle switches to text and back', () => {
    render(<>{secretField.render({
      schema: { type: 'string', 'x-secret': true },
      value: 'pw', onCommit: () => {},
    })}</>);
    const input = screen.getByLabelText(/secret value/i) as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: /show|reveal/i });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    fireEvent.click(toggle);
    expect(input.type).toBe('password');
  });

  it('commits on blur', () => {
    const onCommit = vi.fn();
    render(<>{secretField.render({
      schema: { type: 'string', 'x-secret': true },
      value: '', onCommit,
    })}</>);
    const input = screen.getByLabelText(/secret value/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'newpw' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('newpw');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-secret-field.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement SecretField**

```tsx
import { useState } from 'react';
import type { FieldRenderer } from './index';

export const secretField: FieldRenderer = {
  matches: (s) => s.type === 'string' && s['x-secret'] === true,
  render: ({ value, error, onCommit }) => (
    <SecretInput value={value as string | undefined} onCommit={onCommit} error={error} />
  ),
};

function SecretInput(p: { value: string | undefined; onCommit: (v: string) => void; error?: string }) {
  const [local, setLocal] = useState(p.value ?? '');
  const [revealed, setRevealed] = useState(false);
  return (
    <span>
      <input
        type={revealed ? 'text' : 'password'}
        aria-label="Secret value"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => p.onCommit(local)}
      />
      <button type="button" onClick={() => setRevealed(r => !r)}
              aria-label={revealed ? 'Hide secret' : 'Reveal secret'}>
        {revealed ? 'Hide' : 'Show'}
      </button>
      {p.error && <small className="field-error">{p.error}</small>}
    </span>
  );
}
```

- [ ] **Step 4: Register SecretField BEFORE StringField**

In `src/plugins/config/fieldRenderers/index.ts`, update the registration block — `secretField` must be registered before `stringField` so matchers see it first for `x-secret:true`:

```ts
import { secretField } from './SecretField';
// ...
defaultFieldRendererRegistry.register(numberField);
defaultFieldRendererRegistry.register(booleanField);
defaultFieldRendererRegistry.register(secretField);   // before stringField
defaultFieldRendererRegistry.register(stringField);
```

Also add: `export { secretField } from './SecretField';`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-secret-field.test.tsx`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/config/fieldRenderers/SecretField.tsx src/plugins/config/fieldRenderers/index.ts src/__tests__/plugins-config-secret-field.test.tsx
git commit -m "feat(plugins): SecretField renderer (password input + reveal toggle)"
```

---

### Task 16: ArrayField

**Files:**
- Create: `src/plugins/config/fieldRenderers/ArrayField.tsx`
- Modify: `src/plugins/config/fieldRenderers/index.ts`
- Test: `src/__tests__/plugins-config-array-field.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { arrayField, FieldRendererRegistry, stringField } from '../plugins/config/fieldRenderers';

describe('ArrayField', () => {
  it('matches type:array', () => {
    expect(arrayField.matches({ type: 'array', items: { type: 'string' } })).toBe(true);
    expect(arrayField.matches({ type: 'string' })).toBe(false);
  });

  it('renders one row per initial item using items schema', () => {
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{arrayField.render({
      schema: { type: 'array', items: { type: 'string' } },
      value: ['a', 'b'],
      onCommit: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('Add appends a row; Remove removes one; commit fires with full array', () => {
    const onCommit = vi.fn();
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{arrayField.render({
      schema: { type: 'array', items: { type: 'string' } },
      value: ['x'],
      onCommit,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(inputs[1], { target: { value: 'y' } });
    fireEvent.blur(inputs[1]);
    expect(onCommit).toHaveBeenLastCalledWith(['x', 'y']);

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    expect(onCommit).toHaveBeenLastCalledWith(['y']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-array-field.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ArrayField**

The renderer takes an optional `_registry` prop (private convention: child renderers are looked up from the registry passed by the form). Default to `defaultFieldRendererRegistry` when absent.

```tsx
import { useState, ReactNode } from 'react';
import type { FieldRenderer } from './index';
import { defaultFieldRendererRegistry, FieldRendererRegistry } from './index';
import type { JSONSchemaProperty } from '../../manifest';

interface ArrayProps {
  schema: JSONSchemaProperty;
  value: unknown;
  onCommit: (v: unknown[]) => void;
  _registry?: FieldRendererRegistry;
}

export const arrayField: FieldRenderer = {
  matches: (s) => s.type === 'array',
  render: (props) => <ArrayBody {...(props as ArrayProps)} />,
};

function ArrayBody(p: ArrayProps): ReactNode {
  const initial = Array.isArray(p.value) ? p.value : [];
  const [items, setItems] = useState<unknown[]>(initial);
  const childRegistry = p._registry ?? defaultFieldRendererRegistry;
  const itemSchema = p.schema.items;
  if (!itemSchema) return <em>(invalid array schema: missing items)</em>;
  const child = childRegistry.find(itemSchema);
  if (!child) return <em>(no renderer for item type {itemSchema.type})</em>;

  const set = (next: unknown[]) => { setItems(next); p.onCommit(next); };
  const setOne = (i: number, v: unknown) => {
    const next = items.slice(); next[i] = v; set(next);
  };
  const removeAt = (i: number) => {
    const next = items.slice(); next.splice(i, 1); set(next);
  };
  const add = () => set([...items, defaultFor(itemSchema)]);

  return (
    <div className="array-field">
      {items.map((v, i) => (
        <div key={i} className="array-row">
          {child.render({ schema: itemSchema, value: v, onCommit: (nv) => setOne(i, nv) })}
          <button type="button" onClick={() => removeAt(i)}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={add}>Add</button>
    </div>
  );
}

function defaultFor(s: JSONSchemaProperty): unknown {
  if (s.default !== undefined) return s.default;
  switch (s.type) {
    case 'string':  return '';
    case 'integer':
    case 'number':  return 0;
    case 'boolean': return false;
    case 'array':   return [];
    case 'object':  return {};
  }
}
```

- [ ] **Step 4: Register in index**

In `fieldRenderers/index.ts`:

```ts
import { arrayField } from './ArrayField';
defaultFieldRendererRegistry.register(arrayField);
export { arrayField } from './ArrayField';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-array-field.test.tsx`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/config/fieldRenderers/ArrayField.tsx src/plugins/config/fieldRenderers/index.ts src/__tests__/plugins-config-array-field.test.tsx
git commit -m "feat(plugins): ArrayField renderer with add/remove rows"
```

---

### Task 17: ObjectField

**Files:**
- Create: `src/plugins/config/fieldRenderers/ObjectField.tsx`
- Modify: `src/plugins/config/fieldRenderers/index.ts`
- Test: `src/__tests__/plugins-config-object-field.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { objectField, FieldRendererRegistry, stringField } from '../plugins/config/fieldRenderers';

describe('ObjectField', () => {
  it('matches type:object', () => {
    expect(objectField.matches({ type: 'object', properties: {} })).toBe(true);
  });

  it('renders one child field per property', () => {
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{objectField.render({
      schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
      value: { a: 'x', b: 'y' },
      onCommit: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('commits a merged object when a child commits', () => {
    const onCommit = vi.fn();
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{objectField.render({
      schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
      value: { a: 'x', b: 'y' },
      onCommit,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: 'changed' } });
    fireEvent.blur(inputs[0]);
    expect(onCommit).toHaveBeenLastCalledWith({ a: 'changed', b: 'y' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-object-field.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ObjectField**

```tsx
import { ReactNode } from 'react';
import type { FieldRenderer } from './index';
import { defaultFieldRendererRegistry, FieldRendererRegistry } from './index';
import type { JSONSchemaProperty } from '../../manifest';

interface ObjectProps {
  schema: JSONSchemaProperty;
  value: unknown;
  onCommit: (v: Record<string, unknown>) => void;
  _registry?: FieldRendererRegistry;
}

export const objectField: FieldRenderer = {
  matches: (s) => s.type === 'object',
  render: (props) => <ObjectBody {...(props as ObjectProps)} />,
};

function ObjectBody(p: ObjectProps): ReactNode {
  const reg = p._registry ?? defaultFieldRendererRegistry;
  const v = (p.value && typeof p.value === 'object') ? p.value as Record<string, unknown> : {};
  const props = p.schema.properties ?? {};
  return (
    <details open className="object-field">
      <summary>{p.schema.title ?? '(object)'}</summary>
      {Object.entries(props).map(([k, childSchema]) => {
        const child = reg.find(childSchema);
        if (!child) return <div key={k}><em>(no renderer for {k})</em></div>;
        return (
          <div key={k} className="object-row">
            <label>{childSchema.title ?? k}</label>
            {child.render({
              schema: childSchema,
              value: v[k],
              onCommit: (cv) => p.onCommit({ ...v, [k]: cv }),
            })}
          </div>
        );
      })}
    </details>
  );
}
```

- [ ] **Step 4: Register**

In `fieldRenderers/index.ts`:

```ts
import { objectField } from './ObjectField';
defaultFieldRendererRegistry.register(objectField);
export { objectField } from './ObjectField';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-object-field.test.tsx`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/config/fieldRenderers/ObjectField.tsx src/plugins/config/fieldRenderers/index.ts src/__tests__/plugins-config-object-field.test.tsx
git commit -m "feat(plugins): ObjectField renderer (collapsible nested form)"
```

---

### Task 18: PluginConfigForm — base state + render + Save/Cancel

**Files:**
- Create: `src/plugins/ui/PluginConfigForm.tsx`
- Test: `src/__tests__/plugins-config-form-base.test.tsx`

This task ships the form without undo/redo. Task 19 adds the stacks.

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginConfigForm } from '../plugins/ui/PluginConfigForm';
import type { ConfigurationContribution } from '../plugins/manifest';

const schema: ConfigurationContribution = {
  title: 'Datafleet',
  properties: {
    url:      { type: 'string', minLength: 1, title: 'URL' },
    password: { type: 'string', 'x-secret': true, title: 'Password' },
    timeout:  { type: 'integer', minimum: 0, maximum: 100, default: 30, title: 'Timeout' },
  },
  required: ['url'],
};

describe('PluginConfigForm — base', () => {
  it('renders one field per property using the registry', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x', timeout: 30 }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    expect(screen.getByLabelText('URL')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByLabelText('Timeout')).toBeTruthy();
  });

  it('Save button disabled with no dirty keys', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save enabled after a dirty edit; calls onSave with current values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={onSave} onCancel={() => {}}
    />);
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'http://new' } });
    fireEvent.blur(urlInput);
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://new' }))
    );
  });

  it('Save disabled when validation errors exist', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: '' } });   // violates minLength:1
    fireEvent.blur(urlInput);
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Cancel reverts to initial and calls onCancel', () => {
    const onCancel = vi.fn();
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={async () => {}} onCancel={onCancel}
    />);
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'changed' } });
    fireEvent.blur(urlInput);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe('http://x');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-form-base.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PluginConfigForm.tsx` (no undo yet)**

```tsx
import { useState, useMemo, ReactElement } from 'react';
import type { ConfigurationContribution } from '../manifest';
import { validateConfig } from '../config/schemaValidator';
import { defaultFieldRendererRegistry } from '../config/fieldRenderers';
import type { FieldRendererRegistry } from '../config/fieldRenderers';
import type { ConfigValueError } from '../config/types';

interface Props {
  schema: ConfigurationContribution;
  initialValues: Record<string, unknown>;
  onSave:   (values: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  compact?: boolean;
  registry?: FieldRendererRegistry;
}

export function PluginConfigForm(p: Props): ReactElement {
  const [values, setValues] = useState<Record<string, unknown>>(p.initialValues);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const registry = p.registry ?? defaultFieldRendererRegistry;

  const errors = useMemo<ConfigValueError[]>(
    () => validateConfig(p.schema, values),
    [p.schema, values]
  );
  const errorsByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of errors) m[e.key] = e.message;
    return m;
  }, [errors]);

  const commit = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setDirtyKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const canSave = dirtyKeys.size > 0 && errors.length === 0;

  const save = async () => {
    if (!canSave) return;
    await p.onSave(values);
    setDirtyKeys(new Set());
  };
  const cancel = () => {
    setValues(p.initialValues);
    setDirtyKeys(new Set());
    p.onCancel();
  };

  return (
    <form className={`plugin-config-form${p.compact ? ' compact' : ''}`}
          onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {!p.compact && <h3>{p.schema.title}</h3>}
      {Object.entries(p.schema.properties).map(([key, propSchema]) => {
        const r = registry.find(propSchema);
        if (!r) return <div key={key}><em>(no renderer for {key})</em></div>;
        return (
          <div key={key} className="form-row">
            <label htmlFor={`field-${key}`}>{propSchema.title ?? key}</label>
            {r.render({
              schema: propSchema,
              value: values[key],
              error: errorsByKey[key],
              onCommit: (v) => commit(key, v),
            })}
            {propSchema.description && <small className="field-description">{propSchema.description}</small>}
          </div>
        );
      })}
      <div className="form-actions">
        <button type="submit" disabled={!canSave}>Save</button>
        <button type="button" onClick={cancel}>Cancel</button>
      </div>
    </form>
  );
}
```

Note: the simple primitive renderers in Task 14 don't wire `htmlFor` to a matching input `id`; the test relies on `getByLabelText` matching the `<label>` text content as accessible name when paired with the input inside the same row. If `getByLabelText` fails for any field, update the renderers in Task 14 to accept an optional `id` prop and emit `id={id}` on the input. Easiest path: pass `id={`field-${key}`}` through `FieldRendererProps` (add an optional `id?: string` field to the props type) and have each renderer apply it to its input element. Make that small change here as part of Step 3.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-form-base.test.tsx`
Expected: 5 passing. If `getByLabelText` fails, apply the `id` fix above and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ui/PluginConfigForm.tsx src/plugins/config/fieldRenderers/index.ts src/plugins/config/fieldRenderers/*.tsx src/__tests__/plugins-config-form-base.test.tsx
git commit -m "feat(plugins): PluginConfigForm base (render + save/cancel + validation)"
```

---

### Task 19: PluginConfigForm — cross-field undo/redo

**Files:**
- Modify: `src/plugins/ui/PluginConfigForm.tsx`
- Test: `src/__tests__/plugins-config-form-undo.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PluginConfigForm } from '../plugins/ui/PluginConfigForm';
import type { ConfigurationContribution } from '../plugins/manifest';

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    a: { type: 'string', title: 'A' },
    b: { type: 'string', title: 'B' },
  },
};

function undo(el: HTMLElement) {
  fireEvent.keyDown(el, { key: 'z', metaKey: true });
}
function redo(el: HTMLElement) {
  fireEvent.keyDown(el, { key: 'z', metaKey: true, shiftKey: true });
}

describe('PluginConfigForm — undo/redo', () => {
  it('Cmd-Z walks back through commits across fields regardless of focus', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const b = screen.getByLabelText('B') as HTMLInputElement;
    const form = a.closest('form')!;

    fireEvent.change(a, { target: { value: 'a1' } }); fireEvent.blur(a);
    fireEvent.change(b, { target: { value: 'b1' } }); fireEvent.blur(b);
    fireEvent.change(a, { target: { value: 'a2' } }); fireEvent.blur(a);

    undo(form); // a back to a1
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('a1');
    undo(form); // b back to ''
    expect((screen.getByLabelText('B') as HTMLInputElement).value).toBe('');
    undo(form); // a back to ''
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('');
  });

  it('Cmd-Shift-Z redoes', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const form = a.closest('form')!;
    fireEvent.change(a, { target: { value: 'a1' } }); fireEvent.blur(a);
    undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('');
    redo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('a1');
  });

  it('Save clears both stacks', async () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const form = a.closest('form')!;
    fireEvent.change(a, { target: { value: 'a1' } }); fireEvent.blur(a);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    // After save, undo should be a no-op.
    undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('a1');
  });

  it('caps undo stack at 50; oldest dropped on 51st commit', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const form = a.closest('form')!;
    for (let i = 1; i <= 51; i++) {
      fireEvent.change(a, { target: { value: `v${i}` } });
      fireEvent.blur(a);
    }
    // Undo 50 times — should reach v1 but not the original ''.
    for (let i = 0; i < 50; i++) undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('v1');
    // One more undo is a no-op since stack is empty.
    undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('v1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-form-undo.test.tsx`
Expected: FAIL — no undo behavior.

- [ ] **Step 3: Add undo/redo stacks to `PluginConfigForm.tsx`**

Add a `useRef` for `undoStack` and `redoStack` (refs avoid render-loop issues; the stacks aren't rendered directly). Push the *previous* `values` snapshot on each `commit`. Add a `keyDown` listener on the form root.

Replace the existing `commit` function and add the keyboard handler. Updated body:

```tsx
import { useState, useMemo, useRef, useEffect, ReactElement } from 'react';
// ...existing imports...

const STACK_CAP = 50;

export function PluginConfigForm(p: Props): ReactElement {
  const [values, setValues] = useState<Record<string, unknown>>(p.initialValues);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const undoStack = useRef<Record<string, unknown>[]>([]);
  const redoStack = useRef<Record<string, unknown>[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const registry = p.registry ?? defaultFieldRendererRegistry;

  const errors = useMemo<ConfigValueError[]>(
    () => validateConfig(p.schema, values), [p.schema, values]
  );
  const errorsByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of errors) m[e.key] = e.message;
    return m;
  }, [errors]);

  const pushUndo = (prev: Record<string, unknown>) => {
    undoStack.current.push(prev);
    if (undoStack.current.length > STACK_CAP) undoStack.current.shift();
    redoStack.current = [];
  };

  const commit = (key: string, value: unknown) => {
    setValues(prev => {
      if (prev[key] === value) return prev;
      pushUndo(prev);
      const next = { ...prev, [key]: value };
      return next;
    });
    setDirtyKeys(prev => {
      const next = new Set(prev); next.add(key); return next;
    });
  };

  const handleUndo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setValues(curr => {
      redoStack.current.push(curr);
      return prev;
    });
  };
  const handleRedo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    setValues(curr => {
      undoStack.current.push(curr);
      return next;
    });
  };

  useEffect(() => {
    const el = formRef.current; if (!el) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, []);

  const canSave = dirtyKeys.size > 0 && errors.length === 0;

  const save = async () => {
    if (!canSave) return;
    await p.onSave(values);
    setDirtyKeys(new Set());
    undoStack.current = [];
    redoStack.current = [];
  };
  const cancel = () => {
    setValues(p.initialValues);
    setDirtyKeys(new Set());
    undoStack.current = [];
    redoStack.current = [];
    p.onCancel();
  };

  return (
    <form ref={formRef} className={`plugin-config-form${p.compact ? ' compact' : ''}`}
          onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {/* ...same JSX as Task 18... */}
    </form>
  );
}
```

(Keep the JSX body from Task 18 unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-form-undo.test.tsx`
Expected: 4 passing.

- [ ] **Step 5: Re-run base form tests to confirm no regression**

Run: `npx vitest run src/__tests__/plugins-config-form-base.test.tsx`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/ui/PluginConfigForm.tsx src/__tests__/plugins-config-form-undo.test.tsx
git commit -m "feat(plugins): cross-field undo/redo in PluginConfigForm"
```

---

### Task 20: PluginDetailPane — inline Settings section

**Files:**
- Modify: `src/plugins/ui/PluginDetailPane.tsx`
- Modify: `src/__tests__/plugins-detail-pane.test.tsx` (add cases)

- [ ] **Step 1: Add failing tests to the existing detail-pane test file**

Append to `src/__tests__/plugins-detail-pane.test.tsx`:

```tsx
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

function configRec(schema: ConfigurationContribution) {
  return {
    id: 'p', dir: '/p', state: 'discovered' as const, findings: [],
    manifest: {
      id: 'p', name: 'P', version: '1.0.0',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engines: { mongolens: '^1.0.0' } as any, main: 'm.js',
      contributes: { configuration: schema },
    },
  };
}

function makeConfigService(schema: ConfigurationContribution) {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('p', schema, ws as any, kb);
  const broker = new PermissionBroker();
  return new ConfigService('p', schema, store, broker, { recheckEnforcement: async () => {} });
}

describe('PluginDetailPane — inline Settings section', () => {
  const schema: ConfigurationContribution = {
    title: 'P',
    properties: { url: { type: 'string', title: 'URL' } },
  };

  it('renders Settings section when manifest declares contributes.configuration', async () => {
    const cfgService = makeConfigService(schema);
    render(<PluginDetailPane
      record={configRec(schema)} fs={fsReturning(null)}
      configService={cfgService}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}}
    />);
    await screen.findByText(/Settings/i);
    expect(screen.getByLabelText('URL')).toBeTruthy();
  });

  it('does NOT render Settings section when manifest has no configuration', () => {
    const rec = { id: 'p', dir: '/p', state: 'discovered' as const, findings: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manifest: { id: 'p', name: 'P', version: '1.0.0', engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
    };
    render(<PluginDetailPane record={rec} fs={fsReturning(null)}
      configService={undefined}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}}
    />);
    expect(screen.queryByText(/^Settings$/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-detail-pane.test.tsx`
Expected: FAIL — `configService` prop unknown; no Settings section.

- [ ] **Step 3: Modify `PluginDetailPane.tsx`**

3a. Add `configService` to `Props`:

```tsx
import type { ConfigService } from '../config/ConfigService';

interface Props {
  record: PluginRecord | null;
  fs: PluginFs;
  configService?: ConfigService;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onUninstall: (id: string) => void;
}
```

3b. After the findings section, before the README section, add:

```tsx
{record.manifest?.contributes?.configuration && p.configService && (
  <SettingsSection
    schema={record.manifest.contributes.configuration}
    configService={p.configService}
  />
)}
```

3c. Add the `SettingsSection` helper component in the same file:

```tsx
import { PluginConfigForm } from './PluginConfigForm';

function SettingsSection(p: {
  schema: ConfigurationContribution; configService: ConfigService;
}) {
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    p.configService.getAll().then(v => { if (!cancelled) setInitial(v); });
    return () => { cancelled = true; };
  }, [p.configService]);
  if (!initial) return <section><h4>Settings</h4><p>Loading…</p></section>;
  return (
    <section className="settings-section">
      <h4>Settings</h4>
      <PluginConfigForm
        compact
        schema={p.schema}
        initialValues={initial}
        onSave={async (values) => {
          await p.configService.save(values);
          setInitial(values);
        }}
        onCancel={() => {}}
      />
    </section>
  );
}
```

Also import `ConfigurationContribution`, `useState`, `useEffect`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-detail-pane.test.tsx`
Expected: all passing (10 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ui/PluginDetailPane.tsx src/__tests__/plugins-detail-pane.test.tsx
git commit -m "feat(plugins): inline Settings section in PluginDetailPane"
```

---

### Task 21: PluginConfigRoute — dedicated configure view

**Files:**
- Create: `src/plugins/ui/PluginConfigRoute.tsx`
- Test: `src/__tests__/plugins-config-route.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginConfigRoute } from '../plugins/ui/PluginConfigRoute';
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'P', properties: { url: { type: 'string', title: 'URL' } },
};

function makeSvc() {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('p', schema, ws as any, kb);
  return new ConfigService('p', schema, store, new PermissionBroker(),
    { recheckEnforcement: async () => {} });
}

describe('PluginConfigRoute', () => {
  it('renders breadcrumb with plugin name', async () => {
    render(<PluginConfigRoute pluginName="Datafleet" schema={schema}
      configService={makeSvc()} onBack={() => {}} />);
    await screen.findByText(/Datafleet/);
    expect(screen.getByText(/Plugins.*Datafleet.*Settings/)).toBeTruthy();
  });

  it('renders non-compact form', async () => {
    render(<PluginConfigRoute pluginName="P" schema={schema}
      configService={makeSvc()} onBack={() => {}} />);
    await screen.findByLabelText('URL');
    expect(document.querySelector('.plugin-config-form.compact')).toBeNull();
  });

  it('Back button calls onBack', async () => {
    const onBack = vi.fn();
    render(<PluginConfigRoute pluginName="P" schema={schema}
      configService={makeSvc()} onBack={onBack} />);
    await screen.findByLabelText('URL');
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders "no settings" empty state when schema is null', () => {
    render(<PluginConfigRoute pluginName="P" schema={null}
      configService={undefined} onBack={() => {}} />);
    expect(screen.getByText(/no configurable settings/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-config-route.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PluginConfigRoute.tsx`**

```tsx
import { ReactElement, useEffect, useState } from 'react';
import type { ConfigurationContribution } from '../manifest';
import type { ConfigService } from '../config/ConfigService';
import { PluginConfigForm } from './PluginConfigForm';

interface Props {
  pluginName: string;
  schema: ConfigurationContribution | null;
  configService: ConfigService | undefined;
  onBack: () => void;
}

export function PluginConfigRoute(p: Props): ReactElement {
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!p.configService) return;
    p.configService.getAll().then(v => { if (!cancelled) setInitial(v); });
    return () => { cancelled = true; };
  }, [p.configService]);

  if (!p.schema || !p.configService) {
    return (
      <section className="plugin-config-route">
        <button type="button" onClick={p.onBack}>← Back</button>
        <p>This plugin has no configurable settings.</p>
      </section>
    );
  }
  return (
    <section className="plugin-config-route">
      <nav className="breadcrumb">
        <button type="button" onClick={p.onBack}>← Back</button>
        <span>Plugins / {p.pluginName} / Settings</span>
      </nav>
      {initial === null
        ? <p>Loading…</p>
        : <PluginConfigForm
            schema={p.schema}
            initialValues={initial}
            onSave={async (values) => {
              await p.configService!.save(values);
              setInitial(values);
            }}
            onCancel={p.onBack}
          />}
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-config-route.test.tsx`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ui/PluginConfigRoute.tsx src/__tests__/plugins-config-route.test.tsx
git commit -m "feat(plugins): PluginConfigRoute dedicated configure view"
```

---

### Task 22: Glue — host.ts and usePluginManager wiring

**Files:**
- Modify: `src/plugins/host.ts`
- Modify: `src/plugins/usePluginManager.ts`

- [ ] **Step 1: Inspect current wiring**

Run: `cat src/plugins/host.ts`
Expected: `createPluginHost` constructs `PluginManager`; should already pass `enforcement: defaultEnforcementRegistry` (landed earlier this session).

- [ ] **Step 2: Wire workspace + keychain in `host.ts`**

Add imports:

```ts
import { TauriKeychainBackend, InMemoryKeychainBackend } from './config';
import type { KeychainBackend, WorkspaceLike } from './config';
import { InMemoryWorkspaceStore } from './api/workspaceStore';
```

In `createPluginHost`, before constructing `PluginManager`, build the workspace + keychain. The choice of backend depends on whether Tauri's IPC is available:

```ts
const keychain: KeychainBackend = isTauriEnv()
  ? new TauriKeychainBackend()
  : new InMemoryKeychainBackend();
const workspace: WorkspaceLike = new InMemoryWorkspaceStore();
```

Helper (top of file):

```ts
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
```

Pass them to the manager:

```ts
const manager = new PluginManager({
  // ...existing fields...
  enforcement: defaultEnforcementRegistry,
  workspace,
  keychain,
});
```

Also return `keychain` and `workspace` from `createPluginHost` so the React layer can use them when constructing `ConfigService` instances:

```ts
return { manager, registries, broker, workspace, keychain };
```

(Update the function's return type accordingly.)

- [ ] **Step 3: Build per-plugin ConfigService in `usePluginManager.ts`**

Modify the hook to expose a `getConfigService(pluginId)` function that lazily constructs a `ConfigService` for a plugin that has `contributes.configuration`, and caches it. Add inside the hook:

```ts
import { ConfigService, ConfigStore } from './config';

const configCache = useRef<Map<string, ConfigService>>(new Map());

const getConfigService = useCallback((pluginId: string): ConfigService | undefined => {
  const rec = manager.get(pluginId);
  const schema = rec?.manifest?.contributes?.configuration;
  if (!schema) return undefined;
  const existing = configCache.current.get(pluginId);
  if (existing) return existing;
  const store = new ConfigStore(pluginId, schema, workspace, keychain);
  const svc = new ConfigService(pluginId, schema, store, broker, manager);
  configCache.current.set(pluginId, svc);
  return svc;
}, [manager, workspace, keychain, broker]);
```

Return `getConfigService` from the hook alongside whatever is already returned (e.g. `records`, `install`, `enable`, `disable`, `uninstall`, `fs`).

- [ ] **Step 4: Pass `configService` into the detail pane from wherever PluginsSettingsPane is consumed**

Grep for `PluginsSettingsPane` callers (Settings page). Change them to thread `getConfigService` through `PluginsSettingsPane` → `PluginDetailPane`. Concretely:

4a. Add `getConfigService` to `PluginsSettingsPaneProps`:

```ts
interface Props {
  // ...existing...
  getConfigService?: (pluginId: string) => ConfigService | undefined;
}
```

4b. In `PluginsSettingsPane.tsx`, pass it down: `<PluginDetailPane ... configService={p.getConfigService?.(selectedId)} />`.

4c. Update each caller to pass `getConfigService={getConfigService}`.

- [ ] **Step 5: Run full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: zero TS errors; all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/host.ts src/plugins/usePluginManager.ts src/plugins/ui/PluginsSettingsPane.tsx
# Add any caller files modified in 4c
git commit -m "feat(plugins): wire workspace + keychain + ConfigService into host and UI"
```

---

### Task 23: Documentation — authoring.md

**Files:**
- Modify: `docs/plugins/authoring.md`

- [ ] **Step 1: Add new section after "Permission scopes (v1)"**

Insert before "## Cleanup":

```markdown
## Configuration (`contributes.configuration`)

Declare a JSON Schema describing your settings. The host renders a form in the
plugin's detail pane (and a dedicated route accessible from "Configure…"), users
fill it in, and your plugin reads values via `mongolens.config.*`.

```json
"contributes": {
  "configuration": {
    "title": "My Plugin",
    "properties": {
      "myplugin.apiUrl":   { "type": "string",  "title": "API URL", "format": "uri" },
      "myplugin.username": { "type": "string",  "title": "Username", "minLength": 1 },
      "myplugin.password": { "type": "string",  "title": "Password", "x-secret": true },
      "myplugin.timeout":  { "type": "integer", "title": "Timeout", "default": 30, "minimum": 0, "maximum": 300 }
    },
    "required": ["myplugin.apiUrl", "myplugin.username", "myplugin.password"]
  }
}
```

**Supported keywords:** `type` (`string` / `number` / `integer` / `boolean` /
`array` / `object`), `title`, `description`, `default`, `enum`, `minimum`,
`maximum`, `minLength`, `maxLength`, `pattern`, `format`, `items` (for arrays),
`properties` / `required` (for objects), and `x-secret: true` on strings.
Anything else is rejected at install time.

### `x-secret`

Adding `"x-secret": true` to a string property routes the value through the OS
keychain. The form renders a password input with a reveal toggle. The plugin
must also declare `secrets:read` in `permissions` if it needs to read the value.

### Required configuration

If your plugin truly cannot function without certain settings (e.g. an API
endpoint), list them in `configuration.required`. By default this produces a
warning in the plugin's detail pane. To **block activation** until they are
set, also declare:

```json
"activation": { "requireConfig": true }
```

The Enable button is disabled and a finding shows the user what's missing.

### Plugin API

```ts
// At activate(), capture the API once (see "Capture mongolens once" above).
const { get, getAll, set, onDidChange } = mongolens.config;

const apiUrl   = await get<string>('myplugin.apiUrl');
const username = await get<string>('myplugin.username');
const password = await get<string>('myplugin.password');   // requires secrets:read

context.subscriptions.push(onDidChange(async ({ keys }) => {
  if (keys.some(k => k.startsWith('myplugin.'))) {
    // re-read values and rebuild whatever depends on them
  }
}));
```

- `get` returns the schema default when nothing is stored.
- `set` validates against the schema; throws on failure. Use it for migration
  or "Reset to defaults" UX; ordinary edits flow through the host form.
- `onDidChange` fires **once per Save** with the keys that actually changed.
  Secret values are omitted from the event payload unless the plugin has
  `secrets:read`.

### Saving and undo

The form uses explicit **Save** / **Cancel**. While editing, ⌘Z / ⌘⇧Z (or
Ctrl+Z / Ctrl+Y) walks back and forward through field commits across the
whole form. Stacks clear on Save and Cancel.
```

Also extend the "Required files & enforcement rules" table from the previous spec with the new rule:

```markdown
| `core.required-config` | All keys in `configuration.required` are set | warning, or error if `activation.requireConfig: true` | Fill in the missing fields in the Settings section. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/plugins/authoring.md
git commit -m "docs(plugins): document contributes.configuration, x-secret, requireConfig"
```

---

### Task 24: Integration smoke + final verification

**Files:** none — verification only.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests passing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Rust check**

Run: `cd src-tauri && cargo check && cd ..`
Expected: no errors.

- [ ] **Step 4: Manual UI smoke (deferred to user but document expectations)**

Note in the closing PR comment that the following manual checks remain:
- Run `npm run tauri dev`.
- Use a plugin that declares `contributes.configuration` with `requireConfig: true` and at least one `x-secret` field (datafleet is the natural candidate after migration).
- Confirm: Enable disabled with missing-config finding; Settings section visible; password field shows as `type="password"` with reveal toggle; Save persists; finding clears; Enable becomes enabled; activate succeeds; restarting the app preserves saved values.
- Confirm undo/redo across two fields with ⌘Z / ⌘⇧Z.
- Confirm the "Configure…" link opens the dedicated route.

- [ ] **Step 5: Closing commit (only if any final polish is needed)**

If no further changes are needed, this task closes the plan. Proceed to `superpowers:finishing-a-development-branch`.

---

## Self-review notes

**Spec coverage:**

| Spec section | Implementing task(s) |
|---|---|
| Manifest types + Ajv schema | Task 1 |
| Per-value runtime validation | Task 2 |
| KeychainBackend interface + InMemory | Task 3 |
| Tauri Rust commands + TauriKeychainBackend | Tasks 4–5 |
| SecretStorage refactor (one keychain seam) | Task 6 |
| ConfigStore with x-secret routing + atomic setMany | Task 7 |
| ConfigService with batched save + onDidChange + secrets-gated events | Task 8 |
| RuleContext extension | Task 9 |
| requiredConfigRule | Task 10 |
| PluginManager.recheckEnforcement + workspace+keychain wiring | Task 11 |
| `mongolens.config` exposure | Task 12 |
| Field renderer registry | Task 13 |
| Primitive renderers (String/Number/Boolean) | Task 14 |
| SecretField | Task 15 |
| ArrayField | Task 16 |
| ObjectField | Task 17 |
| PluginConfigForm base | Task 18 |
| PluginConfigForm undo/redo | Task 19 |
| Inline Settings section in PluginDetailPane | Task 20 |
| PluginConfigRoute (dedicated route) | Task 21 |
| host.ts + usePluginManager wiring | Task 22 |
| authoring.md docs | Task 23 |
| Full smoke + manual verification | Task 24 |

**Placeholder scan:** no TBD/TODO/"appropriate"/"similar to Task N". Each task carries the full code for its step. Where Task 18 introduces a label-binding assumption (`getByLabelText`), Step 3 explicitly notes the fix path inside the same task — no deferred work.

**Type consistency check:**
- `ConfigChangeEvent` defined in Task 2's `types.ts`, used in Tasks 8, 12, 23.
- `KeychainBackend.set(namespace, value)` signature is consistent across Tasks 3, 5, 7, 22.
- `ConfigStore.setMany(values) → Promise<string[]>` signature consistent across Tasks 7, 8, 10.
- `ConfigService.save(values)` signature consistent across Tasks 8, 12, 20, 21, 22.
- `PluginConfigForm` props (`schema`, `initialValues`, `onSave`, `onCancel`, `compact?`, `registry?`) consistent across Tasks 18, 19, 20, 21.
- Namespace strings (`plugin:<id>:config:<key>`, `plugin.<id>.config.<key>`, `plugin:<id>:secret:<key>`) consistent across Tasks 6, 7, 10.
- Rule id `core.required-config` consistent across Tasks 10 and 11.
