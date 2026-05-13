# Plugin Enforcement & Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an extensible plugin-enforcement rule registry (first rule: README required, warning severity) and replace the flat plugin settings list with a VS Code–style master-detail pane that shows findings and a sanitized README on the right.

**Architecture:** A new `enforcement/` module exposes `Rule`, `Finding`, and `EnforcementRegistry`. `PluginManager.loadOne()` runs the registry after manifest validation and stores findings on each record; `activate()` refuses when any finding is severity `error`. UI splits into `PluginList` (left) + `PluginDetailPane` (right), with README rendered through `marked` + `DOMPurify`.

**Tech Stack:** TypeScript, React, Vitest, marked, DOMPurify. Existing Ajv manifest validation and `Registry<T>` pattern remain untouched.

**Spec:** `docs/superpowers/specs/2026-05-13-plugin-enforcement-design.md`

---

## File Structure

**New files:**
- `src/plugins/enforcement/types.ts` — `Rule`, `Finding`, `RuleContext` interfaces
- `src/plugins/enforcement/EnforcementRegistry.ts` — registry class with `register`, `all`, `runAll`
- `src/plugins/enforcement/rules/readmePresent.ts` — first built-in rule
- `src/plugins/enforcement/index.ts` — exports + `defaultEnforcementRegistry` instance pre-registered
- `src/plugins/ui/renderReadme.ts` — markdown → sanitized HTML util
- `src/plugins/ui/PluginList.tsx` — left list (presentational, selection-aware)
- `src/plugins/ui/PluginDetailPane.tsx` — right pane (header, findings, README)
- `src/__tests__/plugins-enforcement-registry.test.ts`
- `src/__tests__/plugins-enforcement-readme-rule.test.ts`
- `src/__tests__/plugins-render-readme.test.ts`
- `src/__tests__/plugins-manager-enforcement.test.ts`
- `src/__tests__/plugins-list.test.tsx`
- `src/__tests__/plugins-detail-pane.test.tsx`
- `src/__tests__/plugins-settings-pane.test.tsx` (new — pane currently has no tests)

**Modified files:**
- `src/plugins/io.ts` — add optional `readPluginFile` to `PluginFs`
- `src/plugins/io.tauri.ts` — implement `readPluginFile`
- `src/plugins/PluginManager.ts` — accept `enforcement` option, run registry in `loadOne`, store `findings` on `PluginRecord`, gate `activate()`, export `hasBlockingFindings`
- `src/plugins/ui/PluginsSettingsPane.tsx` — rewrite to master-detail layout
- `package.json` — add `marked`, `dompurify`, `@types/dompurify`

**Untouched:** sandbox, host services, permission broker, manifest schema, harness.

---

### Task 1: Define enforcement types

**Files:**
- Create: `src/plugins/enforcement/types.ts`

- [ ] **Step 1: Create types file**

```ts
import type { PluginManifest } from '../manifest';
import type { PluginFs } from '../io';

export interface RuleContext {
  pluginDir: string;
  manifest: PluginManifest;
  fs: PluginFs;
}

export interface Finding {
  ruleId: string;
  severity: 'error' | 'warning';
  message: string;
  fixHint?: string;
}

export interface Rule {
  id: string;
  title: string;
  defaultSeverity: 'error' | 'warning';
  check(ctx: RuleContext): Promise<Finding[]>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/enforcement/types.ts
git commit -m "feat(plugins): add enforcement rule types"
```

---

### Task 2: EnforcementRegistry — register & all

**Files:**
- Create: `src/plugins/enforcement/EnforcementRegistry.ts`
- Test: `src/__tests__/plugins-enforcement-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { EnforcementRegistry } from '../plugins/enforcement/EnforcementRegistry';
import type { Rule } from '../plugins/enforcement/types';

const noopRule = (id: string): Rule => ({
  id, title: id, defaultSeverity: 'warning',
  check: async () => [],
});

describe('EnforcementRegistry register/all', () => {
  it('registers and lists a rule', () => {
    const reg = new EnforcementRegistry();
    reg.register(noopRule('a'));
    expect(reg.all().map(r => r.id)).toEqual(['a']);
  });

  it('throws on duplicate id', () => {
    const reg = new EnforcementRegistry();
    reg.register(noopRule('a'));
    expect(() => reg.register(noopRule('a'))).toThrow(/already registered/);
  });

  it('preserves registration order', () => {
    const reg = new EnforcementRegistry();
    reg.register(noopRule('a'));
    reg.register(noopRule('b'));
    reg.register(noopRule('c'));
    expect(reg.all().map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-enforcement-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement EnforcementRegistry register/all**

```ts
import type { Rule } from './types';

export class EnforcementRegistry {
  private rules: Rule[] = [];
  private ids = new Set<string>();

  register(rule: Rule): void {
    if (this.ids.has(rule.id)) {
      throw new Error(`EnforcementRegistry: rule "${rule.id}" already registered`);
    }
    this.ids.add(rule.id);
    this.rules.push(rule);
  }

  all(): readonly Rule[] {
    return this.rules;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-enforcement-registry.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/enforcement/EnforcementRegistry.ts src/__tests__/plugins-enforcement-registry.test.ts
git commit -m "feat(plugins): EnforcementRegistry register/all"
```

---

### Task 3: EnforcementRegistry — runAll with error isolation

**Files:**
- Modify: `src/plugins/enforcement/EnforcementRegistry.ts`
- Modify: `src/__tests__/plugins-enforcement-registry.test.ts`

- [ ] **Step 1: Write failing tests for runAll**

Append to `src/__tests__/plugins-enforcement-registry.test.ts`:

```ts
import type { RuleContext, Finding } from '../plugins/enforcement/types';

function dummyCtx(): RuleContext {
  return {
    pluginDir: '/p/x',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifest: { id: 'x', name: 'X', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'main.js' } as any,
    fs: {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
  };
}

describe('EnforcementRegistry runAll', () => {
  it('aggregates findings from all rules in registration order', async () => {
    const reg = new EnforcementRegistry();
    reg.register({ id: 'a', title: 'a', defaultSeverity: 'warning',
      check: async () => [{ ruleId: 'a', severity: 'warning', message: 'A1' }] });
    reg.register({ id: 'b', title: 'b', defaultSeverity: 'warning',
      check: async () => [
        { ruleId: 'b', severity: 'warning', message: 'B1' },
        { ruleId: 'b', severity: 'error',   message: 'B2' },
      ] });
    const findings: Finding[] = await reg.runAll(dummyCtx());
    expect(findings.map(f => f.message)).toEqual(['A1', 'B1', 'B2']);
  });

  it('converts a throwing rule into one synthetic error finding without aborting', async () => {
    const reg = new EnforcementRegistry();
    reg.register({ id: 'boom', title: 'boom', defaultSeverity: 'warning',
      check: async () => { throw new Error('nope'); } });
    reg.register({ id: 'ok', title: 'ok', defaultSeverity: 'warning',
      check: async () => [{ ruleId: 'ok', severity: 'warning', message: 'still ran' }] });
    const findings = await reg.runAll(dummyCtx());
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ ruleId: 'boom', severity: 'error' });
    expect(findings[0].message).toMatch(/boom.*nope/);
    expect(findings[1].message).toBe('still ran');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-enforcement-registry.test.ts`
Expected: FAIL — `runAll is not a function`.

- [ ] **Step 3: Implement runAll**

Replace contents of `src/plugins/enforcement/EnforcementRegistry.ts` with:

```ts
import type { Rule, RuleContext, Finding } from './types';

export class EnforcementRegistry {
  private rules: Rule[] = [];
  private ids = new Set<string>();

  register(rule: Rule): void {
    if (this.ids.has(rule.id)) {
      throw new Error(`EnforcementRegistry: rule "${rule.id}" already registered`);
    }
    this.ids.add(rule.id);
    this.rules.push(rule);
  }

  all(): readonly Rule[] {
    return this.rules;
  }

  async runAll(ctx: RuleContext): Promise<Finding[]> {
    const out: Finding[] = [];
    for (const rule of this.rules) {
      try {
        const findings = await rule.check(ctx);
        out.push(...findings);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        out.push({
          ruleId: rule.id,
          severity: 'error',
          message: `rule "${rule.id}" threw: ${msg}`,
        });
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-enforcement-registry.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/enforcement/EnforcementRegistry.ts src/__tests__/plugins-enforcement-registry.test.ts
git commit -m "feat(plugins): EnforcementRegistry runAll with error isolation"
```

---

### Task 4: PluginFs.readPluginFile (interface + Tauri impl)

**Files:**
- Modify: `src/plugins/io.ts`
- Modify: `src/plugins/io.tauri.ts`

- [ ] **Step 1: Add optional method to PluginFs**

Replace `src/plugins/io.ts` with:

```ts
export interface PluginFs {
  listPluginDirs(): Promise<string[]>;
  readManifest(pluginDir: string): Promise<string>;
  readEntry(entryAbsPath: string): Promise<string>;
  pluginEntryPath(pluginDir: string, manifestMain: string): string;
  copyDir?(src: string, dest: string): Promise<void>;
  removeDir?(dir: string): Promise<void>;
  /** Reads an arbitrary file inside the plugin dir; returns null when absent. */
  readPluginFile?(pluginDir: string, relativePath: string): Promise<string | null>;
}
```

Optional on the interface so existing inline test fs literals do not break. Rules call it through a tolerant helper added in Task 5.

- [ ] **Step 2: Implement readPluginFile in Tauri fs**

Modify `src/plugins/io.tauri.ts`. After the existing `removeDir` method, before the closing brace, add:

```ts
    async readPluginFile(dir, relativePath) {
      try {
        return await readTextFile(`${dir}/${relativePath}`, { baseDir: BASE });
      } catch {
        // Tauri fs throws on missing files; treat any read failure as "absent"
        // so rules can distinguish present-but-empty from missing via content.
        return null;
      }
    },
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/io.ts src/plugins/io.tauri.ts
git commit -m "feat(plugins): add PluginFs.readPluginFile"
```

---

### Task 5: readme-present rule

**Files:**
- Create: `src/plugins/enforcement/rules/readmePresent.ts`
- Test: `src/__tests__/plugins-enforcement-readme-rule.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { readmePresentRule } from '../plugins/enforcement/rules/readmePresent';
import type { RuleContext } from '../plugins/enforcement/types';
import type { PluginFs } from '../plugins/io';

function ctx(file: string | null): RuleContext {
  const fs: PluginFs = {
    listPluginDirs: async () => [],
    readManifest:    async () => '{}',
    readEntry:       async () => '',
    pluginEntryPath: (d, m) => `${d}/${m}`,
    readPluginFile:  async () => file,
  };
  return {
    pluginDir: '/plugins/x',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifest: { id: 'x', name: 'X', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'main.js' } as any,
    fs,
  };
}

describe('readmePresentRule', () => {
  it('returns a warning when README is missing', async () => {
    const findings = await readmePresentRule.check(ctx(null));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'core.readme-present',
      severity: 'warning',
    });
    expect(findings[0].message).toMatch(/missing/i);
    expect(findings[0].fixHint).toBeTruthy();
  });

  it('returns a warning when README is empty or whitespace', async () => {
    const findings = await readmePresentRule.check(ctx('   \n  \t  '));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/empty/i);
  });

  it('returns no findings for a non-empty README', async () => {
    const findings = await readmePresentRule.check(ctx('# Hello\n\nsome content'));
    expect(findings).toEqual([]);
  });

  it('treats a missing readPluginFile method as missing file', async () => {
    const fs: PluginFs = {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
      // no readPluginFile
    };
    const findings = await readmePresentRule.check({
      pluginDir: '/p/x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manifest: { id: 'x', name: 'X', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'main.js' } as any,
      fs,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/missing/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-enforcement-readme-rule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the rule**

```ts
import type { Rule } from '../types';

const RULE_ID = 'core.readme-present';

export const readmePresentRule: Rule = {
  id: RULE_ID,
  title: 'README required',
  defaultSeverity: 'warning',
  async check({ pluginDir, fs }) {
    const content = fs.readPluginFile
      ? await fs.readPluginFile(pluginDir, 'README.md')
      : null;

    if (content === null) {
      return [{
        ruleId: RULE_ID,
        severity: 'warning',
        message: 'README.md is missing',
        fixHint: 'Add a README.md at the plugin root describing what this plugin does.',
      }];
    }
    if (content.trim().length === 0) {
      return [{
        ruleId: RULE_ID,
        severity: 'warning',
        message: 'README.md is empty',
        fixHint: 'Describe what your plugin does, how to enable it, and any required permissions.',
      }];
    }
    return [];
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-enforcement-readme-rule.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/enforcement/rules/readmePresent.ts src/__tests__/plugins-enforcement-readme-rule.test.ts
git commit -m "feat(plugins): readme-present rule (warning severity)"
```

---

### Task 6: enforcement/index.ts — default registry with built-ins

**Files:**
- Create: `src/plugins/enforcement/index.ts`

- [ ] **Step 1: Create index module**

```ts
import { EnforcementRegistry } from './EnforcementRegistry';
import { readmePresentRule } from './rules/readmePresent';

export { EnforcementRegistry };
export * from './types';

/**
 * Default registry, pre-registered with built-in rules. Production code uses
 * this; tests inject their own EnforcementRegistry to assert behavior in
 * isolation.
 *
 * To add a new built-in rule: import it here, then call register below. No
 * other files need editing.
 */
export const defaultEnforcementRegistry = new EnforcementRegistry();
defaultEnforcementRegistry.register(readmePresentRule);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/enforcement/index.ts
git commit -m "feat(plugins): default enforcement registry with built-ins"
```

---

### Task 7: PluginManager — add findings field and run registry on discover

**Files:**
- Modify: `src/plugins/PluginManager.ts`
- Test: `src/__tests__/plugins-manager-enforcement.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { PluginManager, hasBlockingFindings } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { EnforcementRegistry } from '../plugins/enforcement/EnforcementRegistry';
import type { Rule } from '../plugins/enforcement/types';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const MANIFEST = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
};

function makeRule(id: string, findings: Array<{ severity: 'error' | 'warning'; message: string }>): Rule {
  return {
    id, title: id, defaultSeverity: 'warning',
    check: async () => findings.map(f => ({ ruleId: id, ...f })),
  };
}

describe('PluginManager enforcement integration', () => {
  it('populates record.findings after discover when a rule emits warnings', async () => {
    const enforcement = new EnforcementRegistry();
    enforcement.register(makeRule('warn.rule', [{ severity: 'warning', message: 'missing X' }]));
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
      enforcement,
    });
    await mgr.discover();
    const rec = mgr.get('acme.foo')!;
    expect(rec.findings).toHaveLength(1);
    expect(rec.findings[0]).toMatchObject({ ruleId: 'warn.rule', severity: 'warning', message: 'missing X' });
    expect(hasBlockingFindings(rec)).toBe(false);
  });

  it('defaults findings to empty array even with no enforcement option', async () => {
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    expect(mgr.get('acme.foo')!.findings).toEqual([]);
  });

  it('hasBlockingFindings returns true only for error-severity findings', () => {
    expect(hasBlockingFindings({ id: 'x', dir: '/x', state: 'discovered', findings: [] })).toBe(false);
    expect(hasBlockingFindings({ id: 'x', dir: '/x', state: 'discovered',
      findings: [{ ruleId: 'r', severity: 'warning', message: 'm' }] })).toBe(false);
    expect(hasBlockingFindings({ id: 'x', dir: '/x', state: 'discovered',
      findings: [{ ruleId: 'r', severity: 'error', message: 'm' }] })).toBe(true);
  });
});
```

Note: `hasBlockingFindings` takes a record-shaped object; the third assertion constructs minimal literals.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-manager-enforcement.test.ts`
Expected: FAIL — `hasBlockingFindings` not exported / `findings` undefined / `enforcement` option unknown.

- [ ] **Step 3: Modify PluginManager — imports**

At the top of `src/plugins/PluginManager.ts`, add after the existing imports:

```ts
import { EnforcementRegistry, defaultEnforcementRegistry } from './enforcement';
import type { Finding } from './enforcement';
```

- [ ] **Step 4: Modify PluginManager — PluginRecord type**

Replace the existing `PluginRecord` interface with:

```ts
export interface PluginRecord {
  id: string;
  manifest?: PluginManifest;
  dir: string;
  state: PluginState;
  errors?: string[];
  /** Findings emitted by enforcement rules at discovery; empty when clean. */
  findings: Finding[];
}
```

- [ ] **Step 5: Modify PluginManager — ManagerOptions and constructor**

Add `enforcement?: EnforcementRegistry;` to `ManagerOptions`. Store with a default in the constructor by adding a private field:

```ts
private readonly enforcement: EnforcementRegistry;
```

Then in the constructor body (currently `constructor(private readonly opts: ManagerOptions) {}`), change to:

```ts
constructor(private readonly opts: ManagerOptions) {
  this.enforcement = opts.enforcement ?? defaultEnforcementRegistry;
}
```

- [ ] **Step 6: Modify PluginManager — loadOne**

In `loadOne()`, every place a record is `set` with `this.records.set(...)`, add `findings: []` to the record literal **except** the success-branch case where the manifest validated. In the success branch (the final `this.records.set(v.manifest.id, { ... state: 'discovered' })` call), replace it with the block below.

Current code (for reference):
```ts
this.records.set(v.manifest.id, { id: v.manifest.id, dir, manifest: v.manifest, state: 'discovered' });
```

Replace with:
```ts
const findings = await this.enforcement.runAll({ pluginDir: dir, manifest: v.manifest, fs: this.opts.fs });
this.records.set(v.manifest.id, {
  id: v.manifest.id,
  dir,
  manifest: v.manifest,
  state: 'discovered',
  findings,
});
```

For the other `this.records.set` calls inside `loadOne` (the `broken`, `incompatible`, and the outer `catch` branches), add `findings: []` to each record literal.

- [ ] **Step 7: Modify PluginManager — export hasBlockingFindings**

At the bottom of `src/plugins/PluginManager.ts` (after the class definition, before any utility functions like `defaultLoader`), add:

```ts
export function hasBlockingFindings(rec: Pick<PluginRecord, 'findings'>): boolean {
  return rec.findings.some((f) => f.severity === 'error');
}
```

- [ ] **Step 8: Run new tests**

Run: `npx vitest run src/__tests__/plugins-manager-enforcement.test.ts`
Expected: 3 passing.

- [ ] **Step 9: Run full plugin test suite to catch regressions**

Run: `npx vitest run src/__tests__/plugins-manager-discover.test.ts src/__tests__/plugins-manager-activate.test.ts src/__tests__/plugins-manager-events.test.ts src/__tests__/plugins-manager-install.test.ts`
Expected: all passing. If any test fails due to `findings` being undefined on a record literal it constructs, fix that test by adding `findings: []` to the literal.

- [ ] **Step 10: Commit**

```bash
git add src/plugins/PluginManager.ts src/__tests__/plugins-manager-enforcement.test.ts
git commit -m "feat(plugins): run enforcement registry on discover, store findings"
```

---

### Task 8: PluginManager — gate activate() on blocking findings

**Files:**
- Modify: `src/plugins/PluginManager.ts`
- Modify: `src/__tests__/plugins-manager-enforcement.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/plugins-manager-enforcement.test.ts`:

```ts
describe('PluginManager activate gating', () => {
  it('refuses activation when an error-severity finding exists', async () => {
    const enforcement = new EnforcementRegistry();
    enforcement.register(makeRule('err.rule', [{ severity: 'error', message: 'fatal flaw' }]));
    const logger = silentLogger();
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger,
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
      enforcement,
    });
    await mgr.discover();
    await mgr.activate('acme.foo');
    const rec = mgr.get('acme.foo')!;
    expect(rec.state).toBe('failed');
    expect(rec.errors).toEqual(['fatal flaw']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/blocking/i),
      expect.objectContaining({ id: 'acme.foo' }),
    );
  });

  it('allows activation when only warning findings exist', async () => {
    const enforcement = new EnforcementRegistry();
    enforcement.register(makeRule('warn.rule', [{ severity: 'warning', message: 'cosmetic' }]));
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
      enforcement,
    });
    await mgr.discover();
    await mgr.activate('acme.foo');
    expect(mgr.get('acme.foo')!.state).toBe('active');
  });
});
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-manager-enforcement.test.ts`
Expected: the first new test fails (plugin activates instead of being blocked); the second passes.

- [ ] **Step 3: Add gating to activate()**

In `src/plugins/PluginManager.ts`, find the `activate(id: string)` method. After the existing checks `if (!rec || !rec.manifest) {...}` and `if (rec.state === 'active' || rec.state === 'activating') return;`, insert:

```ts
if (hasBlockingFindings(rec)) {
  rec.state = 'failed';
  rec.errors = rec.findings.filter(f => f.severity === 'error').map(f => f.message);
  this.opts.logger.warn('activate: blocking findings prevent activation', { id, findings: rec.errors });
  return;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-manager-enforcement.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Run full plugin suite**

Run: `npx vitest run src/__tests__/`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/PluginManager.ts src/__tests__/plugins-manager-enforcement.test.ts
git commit -m "feat(plugins): block activation on error-severity findings"
```

---

### Task 9: Install marked + DOMPurify

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install runtime deps**

Run: `npm install marked dompurify`
Expected: deps installed, lockfile updated.

- [ ] **Step 2: Install types**

Run: `npm install --save-dev @types/dompurify`
Expected: dev dep installed.
(`marked` ships its own types.)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(plugins): add marked + dompurify for README rendering"
```

---

### Task 10: renderReadme util

**Files:**
- Create: `src/plugins/ui/renderReadme.ts`
- Test: `src/__tests__/plugins-render-readme.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { renderReadme } from '../plugins/ui/renderReadme';

describe('renderReadme', () => {
  it('renders headings, paragraphs, and code blocks', () => {
    const html = renderReadme('# Title\n\nA paragraph.\n\n```\ncode\n```\n');
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toMatch(/<p>A paragraph\.<\/p>/);
    expect(html).toMatch(/<pre><code>code\n<\/code><\/pre>/);
  });

  it('strips <img> tags entirely', () => {
    const html = renderReadme('![alt](http://example.com/x.png)');
    expect(html).not.toMatch(/<img/);
  });

  it('strips href on external anchors but keeps text', () => {
    const html = renderReadme('[click](http://evil.example.com)');
    expect(html).toMatch(/click/);
    expect(html).not.toMatch(/http:\/\/evil/);
  });

  it('preserves anchor links to in-document fragments', () => {
    const html = renderReadme('[section](#section)');
    expect(html).toMatch(/href="#section"/);
  });

  it('strips <script> tags', () => {
    const html = renderReadme('Text <script>alert(1)</script> more');
    expect(html).not.toMatch(/<script/);
    expect(html).toMatch(/Text/);
    expect(html).toMatch(/more/);
  });

  it('strips javascript: URIs from anchors', () => {
    const html = renderReadme('[x](javascript:alert(1))');
    expect(html).not.toMatch(/javascript:/);
  });

  it('strips <style> tags', () => {
    const html = renderReadme('text\n\n<style>body{display:none}</style>');
    expect(html).not.toMatch(/<style/);
  });

  it('strips inline event handlers and style attributes', () => {
    const html = renderReadme('<a href="#x" onclick="alert(1)" style="color:red">link</a>');
    expect(html).not.toMatch(/onclick/);
    expect(html).not.toMatch(/style=/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-render-readme.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement renderReadme**

```ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Markdown -> sanitized HTML for plugin READMEs. Strips all tags and URIs that
 * could phone home or execute code; only in-document anchor links survive.
 * README content ships alongside untrusted plugin code, so we treat it as
 * untrusted content even though it is text.
 */
export function renderReadme(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'object', 'embed', 'svg', 'script', 'style', 'form'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
    ALLOWED_URI_REGEXP: /^#/,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-render-readme.test.ts`
Expected: 8 passing.

If any test fails because DOMPurify in jsdom strips differently than expected (e.g. inline event handlers may already be stripped by default and `FORBID_ATTR` is redundant), inspect the actual HTML output by adding a `console.log(html)` in one test, adjust the assertion (not the implementation) to match the real output, and re-run. The implementation behavior is what matters; the tests are documenting it.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ui/renderReadme.ts src/__tests__/plugins-render-readme.test.ts
git commit -m "feat(plugins): renderReadme util (marked + DOMPurify)"
```

---

### Task 11: PluginList component

**Files:**
- Create: `src/plugins/ui/PluginList.tsx`
- Test: `src/__tests__/plugins-list.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PluginList } from '../plugins/ui/PluginList';
import type { PluginRecord } from '../plugins/PluginManager';

const baseRec = (over: Partial<PluginRecord>): PluginRecord => ({
  id: over.id ?? 'x',
  dir: '/p/x',
  state: over.state ?? 'discovered',
  findings: over.findings ?? [],
  manifest: over.manifest ?? { id: over.id ?? 'x', name: 'X', version: '1.0.0',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
  ...over,
});

describe('PluginList', () => {
  it('renders all records with name and version', () => {
    const records = [
      baseRec({ id: 'a', manifest: { id: 'a', name: 'Alpha', version: '1.0.0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        engines: { mongolens: '^1.0.0' } as any, main: 'm.js' } }),
      baseRec({ id: 'b', manifest: { id: 'b', name: 'Beta',  version: '2.0.0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        engines: { mongolens: '^1.0.0' } as any, main: 'm.js' } }),
    ];
    render(<PluginList records={records} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.getByText(/Beta/)).toBeTruthy();
    expect(screen.getByText(/1\.0\.0/)).toBeTruthy();
    expect(screen.getByText(/2\.0\.0/)).toBeTruthy();
  });

  it('shows the warning indicator for records with warning findings', () => {
    const records = [baseRec({ id: 'a',
      findings: [{ ruleId: 'r', severity: 'warning', message: 'm' }] })];
    render(<PluginList records={records} selectedId={null} onSelect={() => {}} />);
    const item = screen.getByRole('listitem');
    expect(item.getAttribute('data-severity')).toBe('warning');
  });

  it('shows the error indicator for records with any error finding', () => {
    const records = [baseRec({ id: 'a',
      findings: [
        { ruleId: 'r', severity: 'warning', message: 'm1' },
        { ruleId: 'r', severity: 'error',   message: 'm2' },
      ] })];
    render(<PluginList records={records} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole('listitem').getAttribute('data-severity')).toBe('error');
  });

  it('marks the selected item with aria-selected', () => {
    const records = [
      baseRec({ id: 'a' }),
      baseRec({ id: 'b' }),
    ];
    render(<PluginList records={records} selectedId="b" onSelect={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0].getAttribute('aria-selected')).toBe('false');
    expect(items[1].getAttribute('aria-selected')).toBe('true');
  });

  it('fires onSelect with the record id when clicked', () => {
    const onSelect = vi.fn();
    const records = [baseRec({ id: 'a' })];
    render(<PluginList records={records} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('listitem'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PluginList**

```tsx
import { ReactElement } from 'react';
import type { PluginRecord } from '../PluginManager';

interface Props {
  records: PluginRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function severityOf(rec: PluginRecord): 'error' | 'warning' | 'none' {
  if (rec.findings.some(f => f.severity === 'error')) return 'error';
  if (rec.findings.some(f => f.severity === 'warning')) return 'warning';
  return 'none';
}

export function PluginList(p: Props): ReactElement {
  return (
    <ul className="plugin-list" role="list">
      {p.records.map((rec) => {
        const selected = p.selectedId === rec.id;
        const sev = severityOf(rec);
        return (
          <li
            key={rec.id}
            role="listitem"
            aria-selected={selected}
            data-severity={sev}
            onClick={() => p.onSelect(rec.id)}
          >
            <strong>{rec.manifest?.name ?? rec.id}</strong>
            {rec.manifest && <> v{rec.manifest.version}</>}
            {sev === 'warning' && <span aria-label="warnings"> ⚠</span>}
            {sev === 'error'   && <span aria-label="errors">   ⛔</span>}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-list.test.tsx`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ui/PluginList.tsx src/__tests__/plugins-list.test.tsx
git commit -m "feat(plugins): PluginList component (master-detail left)"
```

---

### Task 12: PluginDetailPane component

**Files:**
- Create: `src/plugins/ui/PluginDetailPane.tsx`
- Test: `src/__tests__/plugins-detail-pane.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginDetailPane } from '../plugins/ui/PluginDetailPane';
import type { PluginRecord } from '../plugins/PluginManager';
import type { PluginFs } from '../plugins/io';

const rec = (over: Partial<PluginRecord> = {}): PluginRecord => ({
  id: 'acme.foo',
  dir: '/plugins/acme.foo',
  state: 'discovered',
  findings: [],
  manifest: { id: 'acme.foo', name: 'Foo', version: '1.2.3',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
  ...over,
});

function fsReturning(file: string | null): PluginFs {
  return {
    listPluginDirs: async () => [],
    readManifest:    async () => '{}',
    readEntry:       async () => '',
    pluginEntryPath: (d, m) => `${d}/${m}`,
    readPluginFile:  async () => file,
  };
}

describe('PluginDetailPane', () => {
  it('renders an empty state when no record selected', () => {
    render(<PluginDetailPane record={null} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/Select a plugin/i)).toBeTruthy();
  });

  it('renders header with name, version, and state', () => {
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/Foo/)).toBeTruthy();
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy();
    expect(screen.getByText(/discovered/)).toBeTruthy();
  });

  it('hides findings section when there are no findings', () => {
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.queryByRole('region', { name: /findings/i })).toBeNull();
  });

  it('shows each finding message and fixHint', () => {
    const r = rec({ findings: [
      { ruleId: 'r', severity: 'warning', message: 'missing X', fixHint: 'add X' },
      { ruleId: 'r', severity: 'error',   message: 'broken Y' },
    ] });
    render(<PluginDetailPane record={r} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/missing X/)).toBeTruthy();
    expect(screen.getByText(/add X/)).toBeTruthy();
    expect(screen.getByText(/broken Y/)).toBeTruthy();
  });

  it('disables Enable button when a blocking finding is present', () => {
    const r = rec({ findings: [{ ruleId: 'r', severity: 'error', message: 'no' }] });
    render(<PluginDetailPane record={r} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    const enable = screen.getByRole('button', { name: /Enable/i }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
  });

  it('lazy-loads README via fs.readPluginFile keyed on record id', async () => {
    const readFile = vi.fn(async () => '# Hello\n\ndocs');
    const fs: PluginFs = {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
      readPluginFile:  readFile,
    };
    render(<PluginDetailPane record={rec()} fs={fs}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/plugins/acme.foo', 'README.md'));
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy());
  });

  it('shows "No README" placeholder when readPluginFile returns null', async () => {
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No README/i)).toBeTruthy());
  });

  it('fires onEnable when Enable clicked (no blocking finding)', () => {
    const onEnable = vi.fn();
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={onEnable} onDisable={() => {}} onUninstall={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Enable/i }));
    expect(onEnable).toHaveBeenCalledWith('acme.foo');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-detail-pane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PluginDetailPane**

```tsx
import { ReactElement, useEffect, useState } from 'react';
import type { PluginRecord } from '../PluginManager';
import { hasBlockingFindings } from '../PluginManager';
import type { PluginFs } from '../io';
import { renderReadme } from './renderReadme';

interface Props {
  record: PluginRecord | null;
  fs: PluginFs;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onUninstall: (id: string) => void;
}

export function PluginDetailPane(p: Props): ReactElement {
  const { record, fs } = p;
  const [readmeHtml, setReadmeHtml] = useState<string | null>(null);
  const [readmeMissing, setReadmeMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReadmeHtml(null);
    setReadmeMissing(false);
    if (!record) return;
    (async () => {
      const md = fs.readPluginFile
        ? await fs.readPluginFile(record.dir, 'README.md')
        : null;
      if (cancelled) return;
      if (md === null) setReadmeMissing(true);
      else setReadmeHtml(renderReadme(md));
    })();
    return () => { cancelled = true; };
  }, [record?.id, fs]);

  if (!record) {
    return <section className="plugin-detail empty">Select a plugin to view details.</section>;
  }

  const blocked = hasBlockingFindings(record);
  const active  = record.state === 'active';

  return (
    <section className="plugin-detail" aria-label="Plugin detail">
      <header>
        <h3>{record.manifest?.name ?? record.id}</h3>
        {record.manifest && <span> v{record.manifest.version}</span>}
        <span> — {record.state}</span>
        <span>
          {active
            ? <button onClick={() => p.onDisable(record.id)}>Disable</button>
            : <button disabled={blocked} title={blocked ? 'Fix blocking findings before enabling' : undefined}
                      onClick={() => p.onEnable(record.id)}>Enable</button>}
          <button onClick={() => p.onUninstall(record.id)}>Uninstall</button>
        </span>
      </header>

      {record.findings.length > 0 && (
        <section role="region" aria-label="Findings" className="findings">
          {record.findings.map((f, i) => (
            <div key={i} data-severity={f.severity} className={`finding finding-${f.severity}`}>
              <strong>{f.severity === 'error' ? '⛔' : '⚠'} {f.message}</strong>
              {f.fixHint && <div className="fix-hint">{f.fixHint}</div>}
            </div>
          ))}
        </section>
      )}

      <section className="readme-section">
        <h4>README</h4>
        {readmeHtml === null && !readmeMissing && <p>Loading…</p>}
        {readmeMissing && <p>No README provided by this plugin.</p>}
        {readmeHtml !== null && (
          <div className="readme" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
        )}
      </section>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-detail-pane.test.tsx`
Expected: 8 passing.

If the "renders header with name, version, and state" test fails because text spans are split across elements, switch the brittle assertion to `screen.getByRole('heading', { level: 3 }).textContent` checks instead.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/ui/PluginDetailPane.tsx src/__tests__/plugins-detail-pane.test.tsx
git commit -m "feat(plugins): PluginDetailPane with findings + README"
```

---

### Task 13: Rewrite PluginsSettingsPane to master-detail

**Files:**
- Modify: `src/plugins/ui/PluginsSettingsPane.tsx`
- Test: `src/__tests__/plugins-settings-pane.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginsSettingsPane } from '../plugins/ui/PluginsSettingsPane';
import type { PluginRecord } from '../plugins/PluginManager';
import type { PluginFs } from '../plugins/io';

const fs: PluginFs = {
  listPluginDirs: async () => [],
  readManifest:    async () => '{}',
  readEntry:       async () => '',
  pluginEntryPath: (d, m) => `${d}/${m}`,
  readPluginFile:  async () => null,
};

const rec = (id: string, name: string): PluginRecord => ({
  id, dir: `/p/${id}`, state: 'discovered', findings: [],
  manifest: { id, name, version: '1.0.0',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
});

describe('PluginsSettingsPane', () => {
  it('renders the install button', () => {
    render(<PluginsSettingsPane records={[]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByRole('button', { name: /Install/i })).toBeTruthy();
  });

  it('auto-selects the first record on mount', async () => {
    render(<PluginsSettingsPane records={[rec('a', 'Alpha'), rec('b', 'Beta')]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await waitFor(() => {
      const detail = screen.getByLabelText(/Plugin detail/i);
      expect(detail.textContent).toMatch(/Alpha/);
    });
  });

  it('switches detail pane when a different list item is clicked', async () => {
    render(<PluginsSettingsPane records={[rec('a', 'Alpha'), rec('b', 'Beta')]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    const items = screen.getAllByRole('listitem');
    fireEvent.click(items[1]);
    await waitFor(() => {
      const detail = screen.getByLabelText(/Plugin detail/i);
      expect(detail.textContent).toMatch(/Beta/);
    });
  });

  it('shows empty state when there are no plugins', () => {
    render(<PluginsSettingsPane records={[]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/No plugins installed/i)).toBeTruthy();
  });

  it('passes through onInstall callback', () => {
    const onInstall = vi.fn();
    render(<PluginsSettingsPane records={[]} fs={fs}
      onInstall={onInstall} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Install/i }));
    expect(onInstall).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/plugins-settings-pane.test.tsx`
Expected: FAIL — props mismatch (`fs` not accepted) and detail pane absent.

- [ ] **Step 3: Rewrite PluginsSettingsPane**

Replace the contents of `src/plugins/ui/PluginsSettingsPane.tsx` with:

```tsx
import { ReactElement, useEffect, useState } from 'react';
import type { PluginRecord } from '../PluginManager';
import type { PluginFs } from '../io';
import { PluginList } from './PluginList';
import { PluginDetailPane } from './PluginDetailPane';

interface Props {
  records: PluginRecord[];
  fs: PluginFs;
  onInstall:   () => void;
  onEnable:    (id: string) => void;
  onDisable:   (id: string) => void;
  onUninstall: (id: string) => void;
}

export function PluginsSettingsPane(p: Props): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId === null && p.records.length > 0) {
      setSelectedId(p.records[0].id);
      return;
    }
    if (selectedId !== null && !p.records.some(r => r.id === selectedId)) {
      setSelectedId(p.records[0]?.id ?? null);
    }
  }, [p.records, selectedId]);

  const selected = p.records.find(r => r.id === selectedId) ?? null;

  return (
    <section aria-label="Plugins" className="plugins-settings">
      <header>
        <h2>Plugins</h2>
        <button onClick={p.onInstall}>Install from folder…</button>
      </header>
      {p.records.length === 0 ? (
        <p className="empty-state">No plugins installed.</p>
      ) : (
        <div className="plugins-master-detail" style={{ display: 'flex' }}>
          <PluginList
            records={p.records}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <PluginDetailPane
            record={selected}
            fs={p.fs}
            onEnable={p.onEnable}
            onDisable={p.onDisable}
            onUninstall={p.onUninstall}
          />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/plugins-settings-pane.test.tsx`
Expected: 5 passing.

- [ ] **Step 5: Update callers**

Find every caller of `PluginsSettingsPane`:

Run: `grep -rn "PluginsSettingsPane" src/ --include="*.tsx" --include="*.ts"`

For each caller (typically the Settings page that wires `usePluginManager()` to UI), pass the `fs` prop from wherever the `PluginManager` was constructed. Inspect `src/plugins/usePluginManager.ts` to confirm where the `fs` instance lives; thread it through to the pane.

If `usePluginManager` does not currently expose `fs`, update its return shape to include the `PluginFs` instance it constructed.

- [ ] **Step 6: Run typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: zero TS errors; all tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/ui/PluginsSettingsPane.tsx src/__tests__/plugins-settings-pane.test.tsx src/plugins/usePluginManager.ts
# Add any caller files modified in Step 5
git commit -m "feat(plugins): master-detail layout for plugins settings"
```

---

### Task 14: Manual smoke test + final regression run

**Files:** none — verification only.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests passing.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint (if configured)**

Run: `npm run lint 2>/dev/null || echo "no lint script"`
Expected: no errors (or "no lint script").

- [ ] **Step 4: Manual UI verification**

Start the dev server: `npm run tauri dev` (or `npm run dev` if Tauri shell not needed).
Manually verify:
- Open Settings → Plugins.
- Install a plugin folder that has **no** README.md → confirm the warning indicator (⚠) appears in the list and the finding shows in the detail pane with the fix hint.
- Install a plugin folder **with** a README.md containing markdown → confirm the rendered README appears in the right pane with headings/code/links.
- Confirm an external link (`http://example.com`) is rendered as plain text (no `href`).
- Confirm `<img>`, `<script>`, and inline `<style>` blocks in a README do not render.
- Click between plugins in the list → confirm the detail pane swaps and README re-loads.
- If you can construct a plugin that produces an error-severity finding (via a test rule), confirm the Enable button is disabled.

This is the only step the test suite cannot cover; do not skip it.

- [ ] **Step 5: Final commit (if any docs or polish remain)**

If everything passes and no further changes are needed, this task closes the plan. Move to PR / branch finalization via the `superpowers:finishing-a-development-branch` skill.

---

## Self-Review Notes

Spec coverage check:
- Per-rule severity, `error` blocks, `warning` flags → Tasks 1, 5, 7, 8.
- README warning rule shipped as first built-in → Tasks 5, 6.
- Master-detail VS Code–style UI → Tasks 11, 12, 13.
- Sanitized markdown, only `#`-anchor links → Tasks 9, 10.
- One-file extensibility for next rule → satisfied by `enforcement/index.ts` (Task 6) + isolated `rules/` folder.
- `hasBlockingFindings` helper → Task 7.
- `readPluginFile` on `PluginFs` → Task 4 (kept optional to avoid breaking existing inline test fs literals).
- No new `PluginState` value → preserved; gating goes through `state = 'failed'` at activate time, matching the spec.

Placeholder scan: no TBD/TODO/"appropriate"/"similar to Task N" found.

Type consistency: `Finding`, `Rule`, `RuleContext`, `EnforcementRegistry`, `hasBlockingFindings` referenced consistently across tasks 1, 2, 3, 5, 6, 7, 8, 11, 12. `readPluginFile` signature is `(dir, relativePath) => Promise<string | null>` everywhere.
