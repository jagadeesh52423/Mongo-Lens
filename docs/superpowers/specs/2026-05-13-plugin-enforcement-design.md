# Plugin Enforcement & Detail View — Design

**Date:** 2026-05-13
**Status:** Draft, awaiting user review

## Problem

The plugin system today validates only `manifest.json` (via Ajv) at discovery. There is no mechanism to require additional artefacts — README, LICENSE, referenced asset files, etc. — and no UI surface to show a plugin's description to the user.

Two related needs:

1. **Enforce that every plugin ships a `README.md`** at its root.
2. Make this **extensible**: future rules ("manifest version matches package.json", "icon present", "LICENSE present", "entry file parses") should drop in as new files with no edits to existing code.

A third need falls out naturally: once we have a README, the UI must show it. Today's `PluginsSettingsPane` is a flat list with inline buttons — no place to surface a description.

## Goals

- A registry of enforcement rules; each rule decides its own severity (`error` blocks activation, `warning` only flags).
- A README-present rule shipped as the first built-in, registered at `warning` severity.
- A VS Code-style master-detail UI inside the Plugins settings pane: list left, detail (with findings + rendered README) right. Mirrors the existing `ConnectionPanel` pattern.
- README rendered as sanitized markdown — images, external links, scripts, styles all stripped; only intra-document anchors survive.
- Adding a future rule = one new file under `enforcement/rules/` + one `registry.register(...)` line. No edits to `PluginManager`, no edits to the UI.

## Non-goals

- No on-demand "recheck" button — rules re-run on `discover()`; uninstall/reinstall is the v1 fix loop.
- No introduction of a new `PluginState` enum value. Blocking findings are surfaced via a derived helper, not a state transition.
- No changes to the sandbox, permission broker, host services, or manifest schema. This work is purely additive at discovery + UI.

## Architecture

### Module layout

```
src/plugins/enforcement/
  types.ts                  Rule, Finding, RuleContext interfaces
  EnforcementRegistry.ts    register(), all(), runAll(ctx)
  rules/
    readmePresent.ts        first built-in rule
  index.ts                  exports + default registry pre-registered with built-ins

src/plugins/ui/
  renderReadme.ts           marked + DOMPurify sanitizer util (new)
  PluginList.tsx            left list (new, extracted)
  PluginDetailPane.tsx      right detail (new)
  PluginsSettingsPane.tsx   rewritten to master-detail layout
```

### Rule contract (`enforcement/types.ts`)

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
  id: string;                                  // e.g. "core.readme-present"
  title: string;                               // human-readable
  defaultSeverity: 'error' | 'warning';
  check(ctx: RuleContext): Promise<Finding[]>; // zero, one, or many findings
}
```

Notes:
- A rule may emit multiple findings (e.g. a "manifest hygiene" rule flagging several missing optional fields at once).
- A rule may emit findings with severity different from `defaultSeverity` (e.g. README rule: missing → warning, malformed → error in a future iteration).
- `check` is async — accommodates I/O without forcing sync rules later.

### Registry (`EnforcementRegistry.ts`)

```ts
export class EnforcementRegistry {
  private rules = new Map<string, Rule>();
  register(rule: Rule): void;          // throws on duplicate id
  unregister(ruleId: string): void;
  all(): Rule[];
  async runAll(ctx: RuleContext): Promise<Finding[]>;   // aggregates all rules
}
```

`runAll` catches per-rule exceptions and converts them into one synthetic `error` finding (`{ ruleId, severity: 'error', message: "rule X threw: <err>" }`) rather than aborting the loop. One broken rule must not hide findings from the others.

### Built-in rule (`rules/readmePresent.ts`)

```ts
export const readmePresentRule: Rule = {
  id: 'core.readme-present',
  title: 'README required',
  defaultSeverity: 'warning',
  async check({ pluginDir, fs }) {
    const content = await fs.readPluginFile(pluginDir, 'README.md');
    if (content === null) {
      return [{
        ruleId: 'core.readme-present',
        severity: 'warning',
        message: 'README.md is missing',
        fixHint: 'Add a README.md at the plugin root describing what this plugin does.',
      }];
    }
    if (content.trim().length === 0) {
      return [{
        ruleId: 'core.readme-present',
        severity: 'warning',
        message: 'README.md is empty',
        fixHint: 'Describe what your plugin does, how to enable it, and any required permissions.',
      }];
    }
    return [];
  },
};
```

### Default registry export (`enforcement/index.ts`)

```ts
import { EnforcementRegistry } from './EnforcementRegistry';
import { readmePresentRule } from './rules/readmePresent';

export const defaultEnforcementRegistry = new EnforcementRegistry();
defaultEnforcementRegistry.register(readmePresentRule);

export * from './types';
export { EnforcementRegistry };
```

Adding a future rule:
1. New file under `rules/` exporting a `Rule`.
2. Import + register it in `index.ts`.
3. No edits elsewhere.

### `PluginFs` extension (`io.ts`)

One new method:

```ts
readPluginFile(dir: string, relativePath: string): Promise<string | null>;
// Returns file contents as UTF-8, or null if the file does not exist.
// Other I/O errors (permission denied, etc.) throw.
```

Implementations:
- `io.tauri.ts` — reads from the plugin install root via Tauri fs plugin.
- In-memory test fs — looks up by `${dir}/${relativePath}` in its map.

Rules **only** touch the filesystem via `RuleContext.fs`. No direct Tauri imports in rule files.

### `PluginManager` changes

**`PluginRecord` gains `findings`:**

```ts
export interface PluginRecord {
  id: string;
  manifest?: PluginManifest;
  dir: string;
  state: PluginState;
  errors?: string[];
  findings: Finding[];   // always present; empty array if rules pass
}
```

**`ManagerOptions` accepts an optional registry** (defaults to `defaultEnforcementRegistry`); tests inject a custom registry.

**`loadOne()` flow:**

1. Read + validate manifest (unchanged).
2. If invalid → state `broken`, `findings: []` (unchanged path).
3. If valid → `const findings = await enforcement.runAll({ pluginDir: dir, manifest, fs })`.
4. Store findings on the record.
5. State assignment unchanged: still `discovered` if compatible, `incompatible` otherwise. The state machine is untouched.

**Helper exported from `PluginManager.ts`:**

```ts
export function hasBlockingFindings(rec: PluginRecord): boolean {
  return rec.findings.some((f) => f.severity === 'error');
}
```

**`activate()` gate:** at the top of `activate(id)`, after the existing "unknown plugin" check, if `hasBlockingFindings(rec)` is true:

- Set `rec.state = 'failed'`.
- Set `rec.errors` to the blocking findings' messages.
- Log a warning.
- Return.

This means `error`-severity findings prevent activation outright. Warning-severity findings never block; they exist purely to flag.

### UI — master-detail in `PluginsSettingsPane`

Layout (flex row, two panes):

```
┌─ Plugins ──────────────────────────────────────────────────────┐
│ [Install from folder…]                                          │
├──────────────────┬──────────────────────────────────────────────┤
│ • my-plugin  ⚠  │  my-plugin  v1.2.0   [Disable] [Uninstall]   │
│   other-one     │  state: active                                │
│   broken-one ⛔ │                                                │
│                  │  ⚠ README.md is missing                       │
│                  │     Add a README.md at the plugin root…       │
│                  │                                                │
│                  │  ── README ──────────────────────────────     │
│                  │  <rendered markdown>                          │
└──────────────────┴──────────────────────────────────────────────┘
```

**`PluginList` (extracted, presentational):**
- Props: `records`, `selectedId`, `onSelect(id)`.
- Each item: name, version, state badge, finding indicator (⚠ for warnings, ⛔ for errors, none for clean).
- No action buttons inline — actions move to the detail pane.

**`PluginDetailPane`:**
- Props: `record`, `fs`, `onEnable`, `onDisable`, `onUninstall`.
- Header: name + version, state, action buttons.
- Findings section: groups findings by severity; each row shows `message` and `fixHint`. Hidden entirely when `findings.length === 0`. Enable button is disabled (with a tooltip) when `hasBlockingFindings(record)` is true.
- README section: lazy-loaded via `fs.readPluginFile(record.dir, 'README.md')` when the selected id changes (`useEffect` keyed on `record.id`). Shows a "No README" placeholder when null. Renders through `renderReadme()`.

**`PluginsSettingsPane` (rewritten):**
- Owns `selectedId` state, defaulting to first record on mount.
- Renders `<PluginList>` and `<PluginDetailPane>` side by side.
- Empty state when no plugins installed: "No plugins installed."
- Empty state when none selected (transient): "Select a plugin to view details."

### README rendering (`renderReadme.ts`)

```ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderReadme(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'object', 'embed', 'svg', 'script', 'style', 'form'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
    ALLOWED_URI_REGEXP: /^#/,   // only intra-document anchors
  });
}
```

Consumed via `<div className="readme" dangerouslySetInnerHTML={{ __html: renderReadme(content) }} />`. The input has already been through DOMPurify, which is exactly what `dangerouslySetInnerHTML` is designed for; a React markdown renderer would drag in heavier deps without security gain.

**Rationale for restrictions** (matches the Q4-C choice during brainstorming):
- README ships alongside untrusted plugin code; treat it as untrusted content.
- `FORBID_TAGS` covers every vector that could phone home or execute code, including `<style>` (CSS exfil) and `<form>` (POST exfil).
- `ALLOWED_URI_REGEXP: /^#/` strips `http(s):`, `mailto:`, `data:`, `file:`, and `javascript:` from anchor `href`s. Only `#anchor` links survive.

CSS: rendered HTML is wrapped in `<div className="readme">` so its `h1/h2/p/code/pre` styles are scoped and don't leak into the rest of Settings.

## Data flow

1. `discover()` → for each plugin dir: read manifest → validate → if ok, `runAll(ruleCtx)` → store findings.
2. UI renders list with severity indicators per record.
3. User clicks an item → `PluginDetailPane` mounts, fetches README via `fs.readPluginFile`, renders it.
4. User clicks Enable on a record with blocking findings → button is disabled; if forcibly invoked, `activate()` refuses with `errors` populated from the findings.

## Testing

**Unit (vitest):**
1. `EnforcementRegistry` — register/all/runAll; duplicate-id register throws; a throwing rule yields a single synthetic error finding instead of crashing the loop; multiple rules' findings concatenate in registration order.
2. `readmePresent` rule — missing file → 1 warning ("missing"); empty/whitespace file → 1 warning ("empty"); non-empty → no findings.
3. `renderReadme` — markdown→HTML for headings/code/lists; `<img>` stripped; `<a href="http://evil">x</a>` href stripped; `<a href="#anchor">` preserved; `<script>` stripped; `onerror` attribute stripped; `javascript:` URI stripped; `<style>` stripped.
4. `PluginManager` — error-severity finding causes `activate()` to refuse and populate `errors`; warning-severity findings do not block activation; `findings` is populated after `discover()`; a custom injected registry is used.

**Component (react-testing-library):**
5. `PluginsSettingsPane` — auto-selects first record on mount; clicking a different list item swaps detail pane content; warning/error indicators render per record state.
6. `PluginDetailPane` — calls `fs.readPluginFile(record.dir, 'README.md')` when selection changes; renders README HTML; shows "No README" placeholder when null; findings section hidden when empty; Enable button is disabled when blocking findings present.

**Not added:** harness tests. Enforcement runs in the renderer, not the sandboxed plugin runtime.

## Files

**New:**
- `src/plugins/enforcement/types.ts`
- `src/plugins/enforcement/EnforcementRegistry.ts`
- `src/plugins/enforcement/rules/readmePresent.ts`
- `src/plugins/enforcement/index.ts`
- `src/plugins/ui/renderReadme.ts`
- `src/plugins/ui/PluginList.tsx`
- `src/plugins/ui/PluginDetailPane.tsx`
- Six matching test files under `src/__tests__/`

**Edited:**
- `src/plugins/io.ts` — add `readPluginFile` to interface
- `src/plugins/io.tauri.ts` — implement `readPluginFile`
- In-memory test fs (wherever defined) — implement `readPluginFile`
- `src/plugins/PluginManager.ts` — wire registry, add `findings` field, gate `activate()`, export `hasBlockingFindings`
- `src/plugins/ui/PluginsSettingsPane.tsx` — rewrite to master-detail layout
- `package.json` — add `marked`, `dompurify`, `@types/dompurify`

**Untouched:** sandbox, host services, permission broker, manifest schema, harness.

## Extensibility — adding the next rule

Reference example: future "LICENSE present" rule.

1. Create `src/plugins/enforcement/rules/licensePresent.ts` exporting a `Rule` with `id: 'core.license-present'`, `defaultSeverity: 'warning'`, and a `check` that reads `LICENSE` via `fs.readPluginFile`.
2. In `enforcement/index.ts`, add `import { licensePresentRule } from './rules/licensePresent';` and `defaultEnforcementRegistry.register(licensePresentRule);`.
3. Done. The UI already displays findings; the manager already aggregates them; activation gating already keys off severity.

No edits to `PluginManager`, no edits to UI, no schema changes. This is the openness-to-extension contract the design is buying.
