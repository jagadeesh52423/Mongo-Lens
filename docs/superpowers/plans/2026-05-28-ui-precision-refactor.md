# Precision UI/UX Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform mongo-lens into a futuristic, production-quality "Linear Precision" desktop app — near-black surfaces, hairline borders, refined-green accent, native SF Pro type, real elevation, and balanced motion — by extending the existing token/theme system (no layout/IA change).

**Architecture:** Grow `tokens.css` + `variableSchema.ts` into the single source of truth (global constants, `color-mix`-derived alphas, themeable hex, theme-only shadow strings). Replace the four themes with two hand-tuned ones (`precision-dark`, `precision-light`) and migrate persisted ids. Refit shared `components/ui/*` primitives to consume the new tokens (cascades everywhere), then hand-tune four hero screens. Monaco gets a token-mapped syntax theme.

**Tech Stack:** React 18 + TypeScript, Vite, CSS Modules + CSS custom properties, Zustand (`@tauri-apps/plugin-store`), Monaco editor, Vitest + Testing Library, Tauri v2 (macOS WKWebView).

**Spec:** `docs/superpowers/specs/2026-05-28-ui-precision-refactor-design.md`

**Conventions for every task below:**
- Run the test for a file with `npm test -- <path>`; full suite with `npm test`.
- Typecheck with `npx tsc --noEmit`.
- Commit after each task (messages given per task).
- CSS-module tasks have no unit test; their gate is **`npm test` stays green + `npx tsc --noEmit` clean + the manual visual check stated in the task**. Run the app with `npm run tauri dev` for visual checks.
- Pixel values given are the design target; minor tuning during the visual pass (Task 14) is expected.

**Dependency order:** Phase 1 → Phase 2 must land before Phase 3–4. Within Phase 3 (primitives) and Phase 4 (hero screens), tasks are independent and parallelizable across agents once Phase 2 is merged.

---

## Phase 1 — Token Foundation

### Task 1: Expand `tokens.css` with the full token taxonomy

**Files:**
- Modify (replace contents): `src/styles/tokens.css`

- [ ] **Step 1: Replace the file with the full token set**

```css
/* src/styles/tokens.css
 * Design tokens — the single source of truth for the visual language.
 * Taxonomy: docs/superpowers/specs/2026-05-28-ui-precision-refactor-design.md §3
 *  - themeable hex/font + shadow strings: defaults here, overridden at runtime
 *    by applyTheme() from src/themes/definitions.ts.
 *  - global derived: alpha tokens computed from themeable hex via color-mix().
 *  - global constants: radii, spacing, type, motion, z-index (same every theme).
 * To add a token: see the spec's "Extension Contract".
 */
:root {
  /* ---- themeable defaults (fallback = precision-dark) ---- */
  --bg: #0a0b0d;
  --bg-elev-1: #0e1012;
  --bg-elev-2: #131619;
  --bg-elev-3: #181b1f;
  --bg-rail: #08090b;
  --bg-panel: #0e1012;          /* retained alias → Monaco/editor surface */
  --fg: #e6e8eb;
  --fg-muted: #9aa0a8;
  --fg-dim: #6b7079;
  --border: #1c1f24;
  --border-strong: #2a2e34;
  --accent: #3ddc84;
  --accent-press: #2fc472;
  --accent-contrast: #05140c;   /* text/icon drawn on top of --accent */
  --accent-green: #3ddc84;      /* alias */
  --accent-red: #f0796a;
  --accent-red-dim: #3a1714;
  --accent-blue: #7fb3ff;
  --accent-blue-dim: #16263a;
  --syntax-key: #3ddc84;
  --syntax-string: #e3b341;
  --syntax-number: #7fb3ff;
  --syntax-func: #b39bff;
  --syntax-punct: #9aa0a8;

  /* theme-only string defaults (overridden per theme) */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, .45);
  --shadow-2: 0 6px 18px rgba(0, 0, 0, .45);
  --shadow-3: 0 20px 50px rgba(0, 0, 0, .6);
  --shadow-dialog: var(--shadow-3); /* retained alias for legacy refs */

  /* ---- global derived (alpha from themeable hex; rgba fallback then color-mix) ---- */
  --bg-hover: rgba(255, 255, 255, .045);
  --bg-hover: color-mix(in srgb, var(--fg) 4.5%, transparent);
  --bg-active: rgba(61, 220, 132, .10);
  --bg-active: color-mix(in srgb, var(--accent) 10%, transparent);
  --accent-soft: rgba(61, 220, 132, .12);
  --accent-soft: color-mix(in srgb, var(--accent) 12%, transparent);
  --focus-ring-color: rgba(61, 220, 132, .35);
  --focus-ring-color: color-mix(in srgb, var(--accent) 35%, transparent);
  --focus-ring: 0 0 0 3px var(--focus-ring-color);

  /* ---- global constants ---- */
  --font-mono: "SF Mono", Menlo, Consolas, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;

  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;

  --radius-sm: 6px; --radius-md: 9px; --radius-lg: 13px; --radius-pill: 999px;

  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px; --fs-xl: 18px; --fs-2xl: 22px;

  --dur-fast: 120ms; --dur-base: 180ms;
  --ease-standard: cubic-bezier(.2, .6, .2, 1);
  --ease-out: cubic-bezier(.16, 1, .3, 1);

  --z-dropdown: 80; --z-dialog: 100; --z-tooltip: 120;
}
```

- [ ] **Step 2: Verify build + suite still green**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean; all tests PASS (tokens are CSS-only; nothing imports values from this file).

- [ ] **Step 3: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(tokens): expand design tokens with elevation, motion, radii, syntax, derived alphas"
```

---

### Task 2: Extend `variableSchema.ts` (drives the Theme Editor)

**Files:**
- Modify: `src/themes/variableSchema.ts`
- Test (create): `src/themes/variableSchema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/themes/variableSchema.test.ts
import { describe, it, expect } from 'vitest';
import { VARIABLE_SCHEMA, VARIABLE_GROUP_ORDER } from './variableSchema';

const names = VARIABLE_SCHEMA.map((s) => s.name);

describe('VARIABLE_SCHEMA', () => {
  it('includes the new elevation + foreground tokens', () => {
    for (const n of ['--bg-elev-1', '--bg-elev-2', '--bg-elev-3', '--fg-muted', '--border-strong', '--accent-contrast', '--accent-press']) {
      expect(names).toContain(n);
    }
  });

  it('includes the Syntax group with five syntax tokens', () => {
    expect(VARIABLE_GROUP_ORDER).toContain('Syntax');
    const syntax = VARIABLE_SCHEMA.filter((s) => s.group === 'Syntax').map((s) => s.name);
    expect(syntax).toEqual(
      expect.arrayContaining(['--syntax-key', '--syntax-string', '--syntax-number', '--syntax-func', '--syntax-punct']),
    );
  });

  it('only declares color or font kinds (Theme Editor supports no others)', () => {
    for (const s of VARIABLE_SCHEMA) expect(['color', 'font']).toContain(s.kind);
  });

  it('does not expose derived/alpha tokens as editable', () => {
    for (const n of ['--bg-hover', '--bg-active', '--accent-soft', '--focus-ring-color']) {
      expect(names).not.toContain(n);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/themes/variableSchema.test.ts`
Expected: FAIL (Syntax group + new tokens missing; `--bg-hover` currently present).

- [ ] **Step 3: Replace `variableSchema.ts` contents**

```ts
export type VariableKind = 'color' | 'font';
export type VariableGroup = 'Background' | 'Foreground' | 'Border' | 'Accents' | 'Syntax' | 'Fonts';

export interface VariableSpec {
  name: string;
  label: string;
  group: VariableGroup;
  kind: VariableKind;
}

export const VARIABLE_SCHEMA: VariableSpec[] = [
  // Background / surfaces
  { name: '--bg',             label: 'Background',           group: 'Background', kind: 'color' },
  { name: '--bg-elev-1',      label: 'Surface · raised 1',   group: 'Background', kind: 'color' },
  { name: '--bg-elev-2',      label: 'Surface · raised 2',   group: 'Background', kind: 'color' },
  { name: '--bg-elev-3',      label: 'Surface · raised 3',   group: 'Background', kind: 'color' },
  { name: '--bg-rail',        label: 'Rail background',      group: 'Background', kind: 'color' },
  { name: '--bg-panel',       label: 'Editor surface',       group: 'Background', kind: 'color' },
  // Foreground
  { name: '--fg',             label: 'Foreground',           group: 'Foreground', kind: 'color' },
  { name: '--fg-muted',       label: 'Foreground · muted',   group: 'Foreground', kind: 'color' },
  { name: '--fg-dim',         label: 'Foreground · dim',     group: 'Foreground', kind: 'color' },
  // Border
  { name: '--border',         label: 'Border',               group: 'Border',     kind: 'color' },
  { name: '--border-strong',  label: 'Border · strong',      group: 'Border',     kind: 'color' },
  // Accents
  { name: '--accent',         label: 'Accent',               group: 'Accents',    kind: 'color' },
  { name: '--accent-press',   label: 'Accent · pressed',     group: 'Accents',    kind: 'color' },
  { name: '--accent-contrast',label: 'Accent · on-text',     group: 'Accents',    kind: 'color' },
  { name: '--accent-green',   label: 'Accent · green',       group: 'Accents',    kind: 'color' },
  { name: '--accent-red',     label: 'Accent · red',         group: 'Accents',    kind: 'color' },
  { name: '--accent-red-dim', label: 'Accent · red (dim)',   group: 'Accents',    kind: 'color' },
  { name: '--accent-blue',    label: 'Accent · blue',        group: 'Accents',    kind: 'color' },
  { name: '--accent-blue-dim',label: 'Accent · blue (dim)',  group: 'Accents',    kind: 'color' },
  // Syntax
  { name: '--syntax-key',     label: 'Syntax · keyword',     group: 'Syntax',     kind: 'color' },
  { name: '--syntax-string',  label: 'Syntax · string',      group: 'Syntax',     kind: 'color' },
  { name: '--syntax-number',  label: 'Syntax · number',      group: 'Syntax',     kind: 'color' },
  { name: '--syntax-func',    label: 'Syntax · function',    group: 'Syntax',     kind: 'color' },
  { name: '--syntax-punct',   label: 'Syntax · punctuation', group: 'Syntax',     kind: 'color' },
  // Fonts
  { name: '--font-mono',      label: 'Monospace font',       group: 'Fonts',      kind: 'font' },
  { name: '--font-sans',      label: 'Sans font',            group: 'Fonts',      kind: 'font' },
];

export const VARIABLE_GROUP_ORDER: VariableGroup[] =
  ['Background', 'Foreground', 'Border', 'Accents', 'Syntax', 'Fonts'];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/themes/variableSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/themes/variableSchema.ts src/themes/variableSchema.test.ts
git commit -m "feat(themes): add Syntax group + elevation/foreground tokens to variable schema"
```

---

## Phase 2 — Themes, Migration & Monaco

### Task 3: Replace theme definitions with `precision-dark` + `precision-light`

**Files:**
- Modify (replace contents): `src/themes/definitions.ts`
- Test (create): `src/themes/definitions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/themes/definitions.test.ts
import { describe, it, expect } from 'vitest';
import './definitions'; // side-effect: registers themes
import { getThemes, getTheme } from './registry';
import { VARIABLE_SCHEMA } from './variableSchema';

describe('theme definitions', () => {
  it('registers exactly precision-dark and precision-light', () => {
    const ids = getThemes().map((t) => t.id).sort();
    expect(ids).toEqual(['precision-dark', 'precision-light']);
  });

  it('retires orangy and midnight', () => {
    expect(getTheme('orangy')).toBeUndefined();
    expect(getTheme('midnight')).toBeUndefined();
  });

  it('every schema color/font token has a value in both themes', () => {
    for (const id of ['precision-dark', 'precision-light']) {
      const vars = getTheme(id)!.variables;
      for (const spec of VARIABLE_SCHEMA) {
        expect(vars[spec.name], `${id} missing ${spec.name}`).toBeTruthy();
      }
    }
  });

  it('defines per-theme shadow strings', () => {
    for (const id of ['precision-dark', 'precision-light']) {
      expect(getTheme(id)!.variables['--shadow-3']).toContain('px');
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/themes/definitions.test.ts`
Expected: FAIL (ids are mongodb-dark/light/orangy/midnight; new tokens missing).

- [ ] **Step 3: Replace `definitions.ts` contents**

```ts
import { registerTheme } from './registry';

const FONT_MONO = '"SF Mono", Menlo, Consolas, monospace';
const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

registerTheme({
  id: 'precision-dark',
  name: 'Precision Dark',
  variables: {
    '--bg': '#0a0b0d',
    '--bg-elev-1': '#0e1012',
    '--bg-elev-2': '#131619',
    '--bg-elev-3': '#181b1f',
    '--bg-rail': '#08090b',
    '--bg-panel': '#0e1012',
    '--fg': '#e6e8eb',
    '--fg-muted': '#9aa0a8',
    '--fg-dim': '#6b7079',
    '--border': '#1c1f24',
    '--border-strong': '#2a2e34',
    '--accent': '#3ddc84',
    '--accent-press': '#2fc472',
    '--accent-contrast': '#05140c',
    '--accent-green': '#3ddc84',
    '--accent-red': '#f0796a',
    '--accent-red-dim': '#3a1714',
    '--accent-blue': '#7fb3ff',
    '--accent-blue-dim': '#16263a',
    '--syntax-key': '#3ddc84',
    '--syntax-string': '#e3b341',
    '--syntax-number': '#7fb3ff',
    '--syntax-func': '#b39bff',
    '--syntax-punct': '#9aa0a8',
    '--shadow-1': '0 1px 2px rgba(0,0,0,.45)',
    '--shadow-2': '0 6px 18px rgba(0,0,0,.45)',
    '--shadow-3': '0 20px 50px rgba(0,0,0,.6)',
    '--font-mono': FONT_MONO,
    '--font-sans': FONT_SANS,
  },
});

registerTheme({
  id: 'precision-light',
  name: 'Precision Light',
  variables: {
    '--bg': '#ffffff',
    '--bg-elev-1': '#f7f8fa',
    '--bg-elev-2': '#eef0f3',
    '--bg-elev-3': '#e7eaee',
    '--bg-rail': '#f0f1f4',
    '--bg-panel': '#f7f8fa',
    '--fg': '#1a1d21',
    '--fg-muted': '#5b6270',
    '--fg-dim': '#8a909c',
    '--border': '#e3e6ea',
    '--border-strong': '#d2d6dc',
    '--accent': '#12a150',
    '--accent-press': '#0e8a44',
    '--accent-contrast': '#ffffff',
    '--accent-green': '#12a150',
    '--accent-red': '#d64a3c',
    '--accent-red-dim': '#f7d7d2',
    '--accent-blue': '#2f6fed',
    '--accent-blue-dim': '#d9e6fb',
    '--syntax-key': '#0a8f4d',
    '--syntax-string': '#b06a00',
    '--syntax-number': '#1d6fe0',
    '--syntax-func': '#7a4ddb',
    '--syntax-punct': '#5b6270',
    '--shadow-1': '0 1px 2px rgba(20,30,40,.10)',
    '--shadow-2': '0 6px 18px rgba(20,30,40,.12)',
    '--shadow-3': '0 20px 50px rgba(20,30,40,.18)',
    '--font-mono': FONT_MONO,
    '--font-sans': FONT_SANS,
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/themes/definitions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/themes/definitions.ts src/themes/definitions.test.ts
git commit -m "feat(themes): replace 4 themes with hand-tuned precision-dark + precision-light"
```

---

### Task 4: Default theme + persisted-id migration in the settings store

**Files:**
- Modify: `src/store/settings.ts` (`DEFAULT_THEME_ID` line 12; `loadSettings` themeId assignment ~line 175)
- Modify: `src/store/settings.test.ts` (line 25 constant; lines 113/120 override test)

- [ ] **Step 1: Write the failing test (append to `settings.test.ts`)**

```ts
import { migrateThemeId } from './settings';

describe('migrateThemeId', () => {
  it('maps legacy + retired ids to precision themes', () => {
    expect(migrateThemeId('mongodb-dark')).toBe('precision-dark');
    expect(migrateThemeId('light')).toBe('precision-light');
    expect(migrateThemeId('orangy')).toBe('precision-dark');
    expect(migrateThemeId('midnight')).toBe('precision-dark');
  });
  it('passes through current ids unchanged', () => {
    expect(migrateThemeId('precision-dark')).toBe('precision-dark');
    expect(migrateThemeId('precision-light')).toBe('precision-light');
  });
  it('falls back to precision-dark for unknown ids', () => {
    expect(migrateThemeId('totally-unknown')).toBe('precision-dark');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/store/settings.test.ts`
Expected: FAIL (`migrateThemeId` not exported).

- [ ] **Step 3: Edit `settings.ts` — change default + add migration**

Replace line 12:
```ts
const DEFAULT_THEME_ID = 'precision-dark';
```
Add, immediately below the `DEFAULT_ACTIVE_SECTION` constant:
```ts
/**
 * Maps a persisted theme id onto a currently-registered theme. Handles the
 * v1 ids (mongodb-dark/light) and the retired ones (orangy/midnight); any
 * unknown id falls back to the default flagship.
 * To retire/rename a theme later: add an entry here. No caller changes needed.
 */
const THEME_ID_MIGRATION: Record<string, string> = {
  'mongodb-dark': 'precision-dark',
  light: 'precision-light',
  orangy: 'precision-dark',
  midnight: 'precision-dark',
  'precision-dark': 'precision-dark',
  'precision-light': 'precision-light',
};

export function migrateThemeId(id: string): string {
  return THEME_ID_MIGRATION[id] ?? DEFAULT_THEME_ID;
}
```
In `loadSettings`, change the themeId assignment from:
```ts
        themeId: typeof loaded.themeId === 'string' ? loaded.themeId : DEFAULT_THEME_ID,
```
to:
```ts
        themeId: migrateThemeId(typeof loaded.themeId === 'string' ? loaded.themeId : DEFAULT_THEME_ID),
```

- [ ] **Step 4: Update the existing override-persistence test**

In `settings.test.ts`: change line 25 to `const DEFAULT_THEME_ID = 'precision-dark';` and replace the two `'mongodb-dark'` literals (lines ~113/120) with `'precision-dark'`.

- [ ] **Step 5: Run the suite**

Run: `npm test -- src/store/settings.test.ts`
Expected: PASS (migration + override tests).

- [ ] **Step 6: Commit**

```bash
git add src/store/settings.ts src/store/settings.test.ts
git commit -m "feat(settings): default to precision-dark + migrate retired theme ids"
```

---

### Task 5: Token-mapped Monaco syntax theme

**Files:**
- Modify: `src/themes/applyTheme.ts`
- Test (create): `src/themes/monacoRules.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/themes/monacoRules.test.ts
import { describe, it, expect } from 'vitest';
import { buildMonacoSyntaxRules } from './applyTheme';

describe('buildMonacoSyntaxRules', () => {
  it('maps token types to the resolved --syntax-* values (hex without #)', () => {
    const read = (name: string) =>
      ({
        '--syntax-key': '#3ddc84',
        '--syntax-string': '#e3b341',
        '--syntax-number': '#7fb3ff',
        '--syntax-func': '#b39bff',
        '--syntax-punct': '#9aa0a8',
        '--fg': '#e6e8eb',
      })[name] ?? '#000000';

    const rules = buildMonacoSyntaxRules(read);
    expect(rules).toEqual(
      expect.arrayContaining([
        { token: 'keyword', foreground: '3ddc84' },
        { token: 'string', foreground: 'e3b341' },
        { token: 'number', foreground: '7fb3ff' },
        { token: 'identifier', foreground: 'b39bff' },
        { token: 'delimiter', foreground: '9aa0a8' },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/themes/monacoRules.test.ts`
Expected: FAIL (`buildMonacoSyntaxRules` not exported).

- [ ] **Step 3: Edit `applyTheme.ts`**

Add this exported helper (above `applyMonacoTheme`):
```ts
/** Strip a leading '#' so Monaco's `foreground` (which wants bare hex) is happy. */
function bareHex(v: string): string {
  return v.trim().replace(/^#/, '');
}

/**
 * Build Monaco token color rules from a CSS-var reader. Extracted as a pure
 * function so it is unit-testable without the Monaco loader.
 * To add a token mapping: add a row here referencing a --syntax-* var.
 */
export function buildMonacoSyntaxRules(
  read: (name: string) => string,
): { token: string; foreground: string }[] {
  return [
    { token: 'keyword', foreground: bareHex(read('--syntax-key')) },
    { token: 'string', foreground: bareHex(read('--syntax-string')) },
    { token: 'number', foreground: bareHex(read('--syntax-number')) },
    { token: 'identifier', foreground: bareHex(read('--syntax-func')) },
    { token: 'type.identifier', foreground: bareHex(read('--syntax-func')) },
    { token: 'delimiter', foreground: bareHex(read('--syntax-punct')) },
    { token: 'delimiter.bracket', foreground: bareHex(read('--syntax-punct')) },
  ];
}
```
Then update `applyMonacoTheme` so it (a) prefers `--bg-elev-1`, (b) updates the fallback color, and (c) passes the rules. Replace its body with:
```ts
export function applyMonacoTheme(themeId: string): void {
  const merged = mergedVariables(themeId);
  if (!merged) return;
  const panel = merged['--bg-elev-1'] ?? merged['--bg-panel'] ?? merged['--bg'] ?? '#0a0b0d';
  const base = isLightColor(panel) ? 'vs' : 'vs-dark';
  const read = (name: string) => merged[name] ?? '';
  const rules = buildMonacoSyntaxRules(read).filter((r) => r.foreground.length === 6);

  loader.init().then((monaco) => {
    monaco.editor.defineTheme(MONACO_THEME_ID, {
      base,
      inherit: true,
      rules,
      colors: {
        'editor.background': panel,
        'editor.lineHighlightBackground': panel,
        'editorGutter.background': panel,
        'minimap.background': panel,
      },
    });
    monaco.editor.setTheme(MONACO_THEME_ID);
  });
}
```
Note: `mergedVariables` already returns the theme's hex values (no need for `getComputedStyle` since Monaco theming runs off the same registry).

- [ ] **Step 4: Run the new test + the existing applyTheme test**

Run: `npm test -- src/themes/monacoRules.test.ts src/themes/applyTheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/themes/applyTheme.ts src/themes/monacoRules.test.ts
git commit -m "feat(themes): token-mapped Monaco syntax theme via buildMonacoSyntaxRules"
```

---

### Task 6: Phase-2 integration gate

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, clean.

- [ ] **Step 2: Manual smoke**

Run `npm run tauri dev`. Confirm: app boots on **Precision Dark**; Settings → Theme shows exactly *Precision Dark* + *Precision Light*; switching themes recolors the UI **and** the Monaco editor; Theme Editor opens and shows the new Background/Syntax groups with working color pickers.

- [ ] **Step 3: Commit (if any tuning)** — otherwise skip.

```bash
git commit -am "chore: phase-2 theme foundation verified" --allow-empty
```

---

## Phase 3 — Shared Primitive Refactor (`components/ui/*`)

> These cascade to every screen. Each task = CSS-Module edits (+ tiny markup for states). Gate = `npm test` green + `npx tsc --noEmit` clean + the stated visual check. Independent → parallelizable.

### Task 7: Button primitive

**Files:**
- Modify: `src/components/ui/Button/Button.module.css`
- Check: `src/components/ui/Button/__tests__/*` (no color assertions expected)

- [ ] **Step 1: Replace `Button.module.css` contents**

```css
.button {
  display: inline-flex; align-items: center; gap: var(--space-2);
  font: inherit; font-weight: 500; border-radius: var(--radius-sm); cursor: pointer;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
  padding: var(--space-1) var(--space-3);
  transition: background var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard),
              transform var(--dur-fast) var(--ease-standard),
              box-shadow var(--dur-fast) var(--ease-standard);
}
.button:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-strong); }
.button:active:not(:disabled) { transform: translateY(1px); }
.button:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.button:disabled { opacity: 0.5; cursor: not-allowed; }
.sm { padding: 2px var(--space-2); font-size: var(--fs-sm); }
.md { padding: var(--space-1) var(--space-3); font-size: var(--fs-md); }
.primary {
  background: var(--accent); color: var(--accent-contrast); border-color: var(--accent);
}
.primary:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); filter: brightness(1.06); box-shadow: var(--shadow-1); }
.primary:active:not(:disabled) { background: var(--accent-press); border-color: var(--accent-press); filter: none; }
.secondary { background: var(--bg-elev-2); }
.secondary:hover:not(:disabled) { background: var(--bg-elev-3); }
.ghost { border-color: transparent; background: transparent; }
.ghost:hover:not(:disabled) { background: var(--bg-hover); border-color: transparent; }
.danger { color: var(--accent-red); border-color: var(--accent-red); background: transparent; }
.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--accent-red) 14%, transparent); }
.label { display: inline-flex; align-items: center; }
.spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 2: Verify tests + typecheck**

Run: `npm test -- src/components/ui/Button && npx tsc --noEmit`
Expected: PASS / clean. (If a test asserts the old `#001e2b`, update it to expect `var(--accent-contrast)`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Button/Button.module.css
git commit -m "feat(ui): refit Button to precision tokens (accent-contrast, press, focus ring)"
```

---

### Task 8: Dialog + ContextMenu (elevation + blur)

**Files:**
- Modify: `src/components/ui/Dialog/Dialog.module.css` (and the backdrop rule)
- Modify: `src/components/ui/ContextMenu.tsx` styles (inline or its module — match existing pattern in the file)

- [ ] **Step 1: Dialog surface + backdrop.** In `Dialog.module.css`, set the dialog container to `background: var(--bg-elev-3); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-3);` and add an entrance transition `transition: transform var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out);`. Set the backdrop to `background: rgba(0,0,0,.5); backdrop-filter: blur(3px);`.

- [ ] **Step 2: ContextMenu.** Set the menu surface to `background: var(--bg-elev-3); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-3);`; item hover `background: var(--bg-hover);`; separators `border-color: var(--border);`. Follow the file's existing styling mechanism (it currently uses inline styles / a module — keep whichever is present).

- [ ] **Step 3: Verify**

Run: `npm test -- src/components/ui/Dialog src/__tests__/context-menu.test.tsx && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Dialog src/components/ui/ContextMenu.tsx
git commit -m "feat(ui): elevate Dialog + ContextMenu (elev-3, shadow-3, backdrop blur)"
```

---

### Task 9: Remaining primitives — Panel, ListRow, Toolbar, IconButton, FormField, Text, Stack, SplitHandle

**Files (modify each component's `.module.css`, or inline styles where the component uses them):**
- `src/components/ui/Panel/Panel.module.css`
- `src/components/ui/ListRow/ListRow.module.css` (or `ListRow.tsx`)
- `src/components/ui/Toolbar/Toolbar.module.css`
- `src/components/ui/IconButton/IconButton.module.css`
- `src/components/ui/FormField/FormField.module.css`
- `src/components/ui/Text/Text.module.css` (or `Text.tsx`)
- `src/components/ui/Stack/Stack.module.css` (or `Stack.tsx`)
- `src/components/shared/SplitHandle.tsx`

- [ ] **Step 1: Apply the concrete token mapping per component**

- **Panel:** `background: var(--bg-elev-1); border: 1px solid var(--border); border-radius: var(--radius-md);`
- **ListRow:** base `color: var(--fg); border-radius: var(--radius-sm); transition: background var(--dur-fast) var(--ease-standard);`; `:hover { background: var(--bg-hover); }`; selected/active variant `{ background: var(--bg-active); box-shadow: inset 2px 0 0 var(--accent); color: var(--fg); }`.
- **Toolbar:** `background: var(--bg-elev-1); border-bottom: 1px solid var(--border);` consistent control gap `gap: var(--space-2);`.
- **IconButton:** `color: var(--fg-muted); border-radius: var(--radius-md); transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);`; `:hover { background: var(--bg-hover); color: var(--fg); }`; `:focus-visible { outline: none; box-shadow: var(--focus-ring); }`; active/selected `{ color: var(--accent); background: var(--bg-active); }`.
- **FormField:** label `color: var(--fg-muted); font-size: var(--fs-sm);`; the input wrapper focus state `box-shadow: var(--focus-ring); border-color: var(--accent);`; error text `color: var(--accent-red);`.
- **Text:** map size props to `--fs-xs/sm/md/lg/xl/2xl` and tone props to `--fg` / `--fg-muted` / `--fg-dim`.
- **Stack:** map gap props to `--space-1..6` (no color).
- **SplitHandle:** default transparent; `:hover` / dragging → `background: var(--accent);` with `transition: background var(--dur-fast) var(--ease-standard);` and a comfortable hit area.

- [ ] **Step 2: Verify**

Run: `npm test -- src/components/ui src/__tests__/SidePanel.test.tsx && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui src/components/shared/SplitHandle.tsx
git commit -m "feat(ui): refit Panel/ListRow/Toolbar/IconButton/FormField/Text/Stack/SplitHandle to precision tokens"
```

---

### Task 10: Global base styles + scrollbars + reduced-motion

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Replace `globals.css` contents**

```css
/* src/styles/globals.css */
@import './tokens.css';

* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; }
body {
  background: var(--bg); color: var(--fg);
  font-family: var(--font-sans); font-size: var(--fs-md);
  -webkit-font-smoothing: antialiased;
}
button {
  font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--border); padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm); cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard);
}
button:hover { background: var(--bg-hover); }
button:focus-visible { outline: none; box-shadow: var(--focus-ring); }
input, select, textarea {
  font: inherit; color: inherit;
  background: var(--bg-elev-2); border: 1px solid var(--border);
  padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm);
  transition: border-color var(--dur-fast) var(--ease-standard),
              box-shadow var(--dur-fast) var(--ease-standard);
}
input:focus, select:focus, textarea:focus {
  outline: none; border-color: var(--accent); box-shadow: var(--focus-ring);
}
input::placeholder, textarea::placeholder { color: var(--fg-dim); opacity: 1; }

/* thin, unobtrusive scrollbars */
* { scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb {
  background: var(--border-strong); border-radius: var(--radius-pill);
  border: 2px solid transparent; background-clip: content-box;
}
*::-webkit-scrollbar-thumb:hover { background: var(--fg-dim); background-clip: content-box; }
*::-webkit-scrollbar-track { background: transparent; }

.tab-scroll { scrollbar-width: none; -ms-overflow-style: none; }
.tab-scroll::-webkit-scrollbar { display: none; height: 0; width: 0; }

/* honor OS reduced-motion globally */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 2: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(styles): precision base styles, thin scrollbars, global reduced-motion"
```

---

## Phase 4 — Hero Screens

> Independent → parallelizable. Each gate = `npm test` green + `npx tsc --noEmit` clean + stated visual check in `npm run tauri dev` (verify both themes).

### Task 11: App shell · IconRail · StatusBar

**Files:**
- Modify: `src/components/features/layout/AppShell.module.css`
- Modify: `src/components/features/layout/IconRail.tsx` + its module/styles
- Modify: `src/components/features/layout/StatusBar.tsx` + its module/styles

- [ ] **Step 1: IconRail** — rail `background: var(--bg-rail); border-right: 1px solid var(--border);`. Each item: `border-radius: var(--radius-md); color: var(--fg-dim); transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);`. Hover `background: var(--bg-hover); color: var(--fg-muted);`. Active item `color: var(--accent); background: var(--bg-active);` plus a left indicator bar via `::before { content:''; position:absolute; left:0; top:8px; bottom:8px; width:3px; border-radius:0 3px 3px 0; background: var(--accent); }` (ensure the item is `position: relative`).

- [ ] **Step 2: StatusBar** — `background: var(--bg-elev-1); border-top: 1px solid var(--border); color: var(--fg-muted); font-size: var(--fs-xs);`. Add a connection status dot with a pulse:
```css
.statusDot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 0 var(--focus-ring-color); animation: statusPulse 2s infinite; }
@keyframes statusPulse {
  0% { box-shadow: 0 0 0 0 var(--focus-ring-color); }
  70% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
```
Use tabular numerals for counts: `font-variant-numeric: tabular-nums;`. (Global reduced-motion rule already disables the pulse.)

- [ ] **Step 3: AppShell** — ensure panels read `background: var(--bg)` / `var(--bg-elev-1)` and dividers use `var(--border)`; no structural/layout change.

- [ ] **Step 4: Verify**

Run: `npm test -- src/__tests__/IconRail.test.tsx src/__tests__/layout.test.tsx src/__tests__/App.activity-bar.test.tsx && npx tsc --noEmit`
Expected: PASS / clean. Visual: active rail item shows green indicator bar; status dot pulses (and stops under OS reduced-motion).

- [ ] **Step 5: Commit**

```bash
git add src/components/features/layout
git commit -m "feat(layout): precision shell — rail indicator, elevated status bar with pulse"
```

---

### Task 12: Editor + Results workspace

**Files:**
- Modify: `src/components/features/editor/EditorTabBar.tsx` (+styles), `ContextBar.tsx` (+styles), `EditorArea.tsx` (+styles)
- Modify: `src/components/features/results/ResultsToolbar.tsx`, `ResultsPagination.tsx`, `TableView.tsx`, `cellRenderers.tsx`, `JsonView.tsx` (+ their styles)

- [ ] **Step 1: EditorTabBar** — tab base `color: var(--fg-muted); border-bottom: 2px solid transparent; transition: color var(--dur-fast) var(--ease-standard);`. Active tab `color: var(--fg); border-bottom-color: var(--accent);`. Dirty indicator dot `background: var(--accent);`. Close `✕` `color: var(--fg-dim);` → `var(--fg)` on hover.

- [ ] **Step 2: ContextBar** — render connection/namespace/mode as pills: `background: var(--bg-elev-2); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 2px var(--space-2); font-size: var(--fs-xs);`. Status dot inside the connection pill uses `var(--accent)`.

- [ ] **Step 3: ResultsToolbar** — Table/JSON as a segmented control: container `background: var(--bg-elev-2); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden;`; segment `color: var(--fg-muted);`; active segment `background: var(--accent-soft); color: var(--accent); font-weight: 600;`. Meta text `color: var(--fg-dim); font-variant-numeric: tabular-nums;`.

- [ ] **Step 4: ResultsPagination** — `color: var(--fg-muted)`, current-page emphasis `color: var(--fg); font-variant-numeric: tabular-nums;`, control buttons use the global button style + focus ring.

- [ ] **Step 5: TableView** — sticky headers: `position: sticky; top: 0; background: var(--bg-elev-1); border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: .06em; font-size: var(--fs-xs); color: var(--fg-dim); font-weight: 600;`. Body cells: `font-family: var(--font-mono); font-size: var(--fs-sm); border-bottom: 1px solid var(--border); color: var(--fg);`. Row `transition: background var(--dur-fast) var(--ease-standard);`; `:hover { background: var(--bg-hover); }`; selected `background: var(--bg-active);`.

- [ ] **Step 6: cellRenderers** — color values by JS type using syntax tokens (wrap rendered value in a span with the appropriate inline color or a CSS-module class): string → `var(--syntax-string)`; number/bigint → `var(--syntax-number)`; boolean → `var(--accent)`; null/undefined → `var(--fg-dim)`; ObjectId/Date → `var(--syntax-func)`. Keep the existing renderer-registry pattern in the file; only add the color mapping. For status-like string columns rendered as badges, badge style: `display:inline-block; padding:1px 8px; border-radius:var(--radius-pill); font-family:var(--font-sans); font-size:var(--fs-xs); font-weight:600;` active → `background: var(--accent-soft); color: var(--accent);`, neutral → `background: var(--bg-hover); color: var(--fg-muted);`.

- [ ] **Step 7: JsonView** — token-colored keys/values via the same `--syntax-*` mapping; `line-height: 1.6;` `font-family: var(--font-mono);`.

- [ ] **Step 8: Verify**

Run: `npm test -- src/__tests__/results-panel.test.tsx src/__tests__/table-view-selection.test.tsx src/__tests__/results-nav-sort.test.tsx src/__tests__/context-bar.test.tsx src/__tests__/editor-area.test.tsx && npx tsc --noEmit`
Expected: PASS / clean. Visual: query syntax-colored in Monaco; results table has uppercase sticky headers, type-colored monospace cells, badges, hover/selected rows; segmented Table/JSON toggle.

- [ ] **Step 9: Commit**

```bash
git add src/components/features/editor src/components/features/results
git commit -m "feat(workspace): precision editor tabs, context pills, results table + type-colored cells"
```

---

### Task 13: Connection dialog V2 + AI panel

**Files:**
- Modify: `src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx` (+styles) and `tabs/` shared styles, `tabs/shared/ColorPicker.tsx`
- Modify: `src/components/features/ai/AIChatPanel.tsx`, `AIChatHeader.tsx`, `AIMessageBubble.tsx`, `AIChatInput.tsx`, `AIFloatingButton.tsx`, `CodeBlock.tsx` (+ styles)

- [ ] **Step 1: Connection dialog V2** — dialog surface `var(--bg-elev-3)` + `var(--shadow-3)` + `var(--radius-lg)` (inherits from the Dialog primitive if used; otherwise apply directly). Tab rail: inactive `color: var(--fg-muted)`, active `color: var(--accent)` with a `2px` accent indicator. Form rows use FormField tokens; section dividers `var(--border)`. ColorPicker swatches: `border-radius: var(--radius-sm); border: 1px solid var(--border);` selected swatch ring `box-shadow: var(--focus-ring);`.

- [ ] **Step 2: AI floating button** — `background: linear-gradient(135deg, var(--accent), var(--accent-press)); color: var(--accent-contrast); border-radius: 50%; box-shadow: var(--shadow-2); transition: transform var(--dur-fast) var(--ease-standard);`; `:hover { transform: translateY(-2px) scale(1.04); }`.

- [ ] **Step 3: AI panel** — header/input on `var(--bg-elev-1)`, hairline borders; user bubble `background: var(--accent-soft); color: var(--fg);`, assistant bubble `background: var(--bg-elev-2);`. Input focus ring via global input style. `CodeBlock` background `var(--bg-elev-2)`, border `var(--border)`, mono font, optional syntax token colors.

- [ ] **Step 4: Verify**

Run: `npm test -- src/components/features/connections/dialog-v2 && npm test -- src/__tests__/ && npx tsc --noEmit`
Expected: PASS / clean. Visual: dialog has elevation/blur, clean tab rail; AI fab is a gradient pill with hover lift; chat bubbles read cleanly in both themes.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/connections/dialog-v2 src/components/features/ai
git commit -m "feat(connections,ai): precision connection dialog + gradient AI fab and chat surfaces"
```

---

## Phase 5 — Verification & Polish

### Task 14: Full verification + visual QA sweep

- [ ] **Step 1: Full automated gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all tests PASS, typecheck clean, production build succeeds.

- [ ] **Step 2: Manual QA checklist (run `npm run tauri dev`)**
  - Boots on Precision Dark; switch to Precision Light — every surface, border, accent, and the Monaco editor recolor correctly (no leftover dark-on-light or unreadable text).
  - Hero screens in BOTH themes: shell/rail (active indicator), editor tabs + Monaco syntax colors, results table (sticky uppercase headers, type-colored cells, badges, hover/selected), connection dialog V2, AI panel + fab.
  - Focus rings appear on keyboard nav (Tab) for buttons/inputs/icon buttons.
  - Enable macOS *Reduce Motion* → status-dot pulse, hover lifts, and transitions are disabled.
  - Theme Editor: edit a Background and a Syntax token → live update; Reset works; export/import round-trips.
  - Contrast spot-check: `--fg-dim`/`--fg-muted` text and accent-on-surface meet AA in both themes; nudge values in `definitions.ts` if any fail.

- [ ] **Step 3: Commit any tuning**

```bash
git add -A
git commit -m "polish(ui): visual QA tuning across precision themes"
```

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to choose merge/PR/cleanup.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** §3 tokens → Tasks 1–2; §4 themes/migration/editor → Tasks 3–4 (editor auto-adapts, verified Task 6); §5 Monaco → Task 5; §6 primitives → Tasks 7–10; §7 hero screens → Tasks 11–13; §8 motion/a11y → Tasks 10 (global reduced-motion) + per-component transitions + Task 14 contrast; §9 rollout = phase order; §10 extension contract → encoded in code comments (tokens.css, schema, definitions migration, Button, buildMonacoSyntaxRules); §11 tests → Tasks 2–5 + Task 14; §3b aliases → Task 1.
- **Placeholder scan:** none — every code step has concrete content; CSS-sweep steps list exact token mappings/declarations.
- **Type/name consistency:** `migrateThemeId`, `buildMonacoSyntaxRules`, `THEME_ID_MIGRATION`, token names, and theme ids (`precision-dark`/`precision-light`) are used identically across tasks and tests.
