# Theme Customization — Design

**Date:** 2026-05-03
**Status:** Approved (pending implementation)

## Goal

Let users customize the colors (and font variables) of any theme directly in the
Settings → Theme page, with a per-variable and per-theme reset. Built-in themes
must remain pristine on disk; customizations are layered on top via persisted
overrides.

The design must be extensible: adding a new CSS variable, a new variable group,
or a new input kind (e.g. gradient picker) should require only additive changes
— no edits to existing rendering branches.

## Non-Goals

- No theme creation from scratch. Customization always starts from an existing
  theme (built-in or installed).
- No import/export of override sets in v1. The existing per-theme JSON
  export/install path remains untouched.
- No undo/redo history beyond per-variable / per-theme reset.
- No save button. Edits are applied and persisted immediately, consistent with
  the shortcut-overrides pattern in this codebase.

## Architecture

### Layered theme model

Themes resolve as `merged = base.variables ⊕ overrides[themeId]` at the moment
of `applyTheme(themeId)`. Overrides live in a sibling registry; built-in
definitions are never mutated.

```
src/themes/
  registry.ts         (existing — base ThemeDefinition registry, unchanged API)
  definitions.ts      (existing — built-in themes, unchanged)
  applyTheme.ts       (modified — merges overrides into base before applying)
  overrides.ts        (NEW — overrides registry + change subscription)
  variableSchema.ts   (NEW — variable metadata for the editor)
```

### `overrides.ts`

In-memory store keyed by `themeId`:

```ts
type ThemeOverrides = Record<string, Record<string, string>>;
//                            ^themeId   ^varName    ^value

export function getOverrides(themeId: string): Record<string, string>;
export function setVariable(themeId: string, varName: string, value: string): void;
export function resetVariable(themeId: string, varName: string): void;
export function resetTheme(themeId: string): void;
export function getAllOverrides(): ThemeOverrides;
export function hydrateOverrides(initial: ThemeOverrides): void;
export function subscribe(listener: () => void): () => void;
```

- Mutating methods notify subscribers and trigger `persist()` via the settings
  store (see Persistence below).
- `resetVariable` removes the key; if a theme has no remaining overrides, its
  entry is removed from the map (keeps persisted shape clean).
- `subscribe` lets the editor re-render and lets `applyTheme` re-run when the
  active theme is mutated.

### `variableSchema.ts`

Single source of truth for what the editor renders:

```ts
export type VariableKind = 'color' | 'font';
export type VariableGroup = 'Background' | 'Foreground' | 'Border' | 'Accents' | 'Fonts';

export interface VariableSpec {
  name: string;          // e.g. '--bg'
  label: string;         // e.g. 'Background'
  group: VariableGroup;
  kind: VariableKind;
}

export const VARIABLE_SCHEMA: VariableSpec[] = [
  { name: '--bg',              label: 'Background',          group: 'Background', kind: 'color' },
  { name: '--bg-panel',        label: 'Panel background',    group: 'Background', kind: 'color' },
  { name: '--bg-rail',         label: 'Rail background',     group: 'Background', kind: 'color' },
  { name: '--bg-hover',        label: 'Hover background',    group: 'Background', kind: 'color' },
  { name: '--fg',              label: 'Foreground',          group: 'Foreground', kind: 'color' },
  { name: '--fg-dim',          label: 'Foreground (dim)',    group: 'Foreground', kind: 'color' },
  { name: '--border',          label: 'Border',              group: 'Border',     kind: 'color' },
  { name: '--accent',          label: 'Accent',              group: 'Accents',    kind: 'color' },
  { name: '--accent-green',    label: 'Accent — green',      group: 'Accents',    kind: 'color' },
  { name: '--accent-red',      label: 'Accent — red',        group: 'Accents',    kind: 'color' },
  { name: '--accent-red-dim',  label: 'Accent — red (dim)',  group: 'Accents',    kind: 'color' },
  { name: '--accent-blue',     label: 'Accent — blue',       group: 'Accents',    kind: 'color' },
  { name: '--accent-blue-dim', label: 'Accent — blue (dim)', group: 'Accents',    kind: 'color' },
  { name: '--font-mono',       label: 'Monospace font',      group: 'Fonts',      kind: 'font' },
  { name: '--font-sans',       label: 'Sans font',           group: 'Fonts',      kind: 'font' },
];

export const VARIABLE_GROUP_ORDER: VariableGroup[] =
  ['Background', 'Foreground', 'Border', 'Accents', 'Fonts'];
```

To add a new variable: append one entry. The editor and renderer pick it up
automatically.

### `applyTheme.ts` changes

```ts
export function applyTheme(themeId: string): void {
  const theme = getTheme(themeId);
  if (!theme) return;
  const merged = { ...theme.variables, ...getOverrides(themeId) };
  const root = document.documentElement;
  Object.entries(merged).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}
```

`applyMonacoTheme` is updated identically — it must read merged values for
`--bg-panel` / `--bg`.

### Persistence

Extend `PersistedSettings` in [src/store/settings.ts](src/store/settings.ts):

```ts
export interface PersistedSettings {
  themeId: string;
  shortcutOverrides: Record<string, string>;
  themeOverrides: Record<string, Record<string, string>>; // NEW
  aiConfig: PersistedAIConfig;
}
```

- `loadSettings()` calls `hydrateOverrides(loaded.themeOverrides ?? {})` BEFORE
  `applyTheme(themeId)` is invoked at startup, so the first paint uses merged
  values.
- `overrides.ts` does not call `persist` directly; instead it exposes a
  `subscribe` and the settings store wires a single subscription that calls its
  existing `persist` flow with the new field included.
- Backwards compatibility: missing `themeOverrides` in a loaded settings file
  defaults to `{}` — no migration needed.

## UI Flow

### Entry point — pen icon on theme card

`ThemeSection` already has an extensible `actions: ThemeCardAction[]` array
([ThemeSection.tsx:69](src/settings/sections/ThemeSection.tsx#L69)).

Add an "Edit theme" action with a pen icon (`✎`) before the existing export
action. Clicking it calls `setEditingThemeId(theme.id)` and stops propagation
so the card itself doesn't activate the theme.

### View switching inside `ThemeSection`

Local state `editingThemeId: string | null` controls what's rendered:

- `null` → existing grid view (cards + Install button).
- non-null → `<ThemeEditor themeId={...} onBack={() => setEditingThemeId(null)} />`.

No router changes; this is a within-section view swap, mirroring how other
settings sections are flat.

### `ThemeEditor` component

Layout (top to bottom):

1. **Header row**
   - `← Back` button (calls `onBack`).
   - Theme name + small subtitle "Customizing — changes save automatically".
   - `Reset all` button on the right. Disabled when
     `Object.keys(getOverrides(themeId)).length === 0`.

2. **Variable groups**
   - Iterate `VARIABLE_GROUP_ORDER`.
   - For each group, render a section header and the variables in that group
     (filtered from `VARIABLE_SCHEMA`).
   - Each row: `label · input · per-variable Reset link`.
     - `kind: 'color'` → `<input type="color">`. Value comes from merged value
       (override if present, otherwise base).
     - `kind: 'font'` → `<input type="text">`.
     - "Reset" link is shown only when an override exists for that variable.

3. **Live preview**
   - On every input change, call `setVariable(themeId, varName, value)`.
   - The overrides subscription re-runs `applyTheme(themeId)` and
     `applyMonacoTheme(themeId)` whenever the *active* theme changes.
   - For non-active themes, edits are persisted but not applied to the
     document. Next activation will pick them up.

### Behavior matrix

| Action | Editing active theme | Editing inactive theme |
|---|---|---|
| Change a variable | Persisted; live preview applied to whole app + Monaco | Persisted; no visual change |
| Reset variable | Persisted; live preview reverts to base | Persisted; no visual change |
| Reset all | Persisted; live preview reverts whole theme to base | Persisted; no visual change |

### Keyboard / a11y

- Pen icon button: `aria-label="Edit theme"`, focusable; appears on card
  hover/focus (matches existing export-icon behavior).
- `← Back` is a real button.
- Inputs have `<label htmlFor>` associations.
- The `ThemeEditor` view does not trap focus — Settings sidebar still works.

## Extensibility Contracts

| To add… | Do this | Touches existing code? |
|---|---|---|
| A new CSS variable | Add one entry to `VARIABLE_SCHEMA` and to each theme in `definitions.ts` | No (additive only) |
| A new variable group | Add to `VariableGroup` union and `VARIABLE_GROUP_ORDER` | No edits to render branches |
| A new input kind (e.g. `gradient`) | Extend `VariableKind` union, add a `case` to the row renderer's `switch(kind)` | One additive `case` |
| A new card action (e.g. duplicate theme) | Push another entry into the `actions` array in `ThemeSection` | One line |

The existing `ThemeCardAction` registry in `ThemeSection` is the extension
point for hover-icon actions; the `VARIABLE_SCHEMA` array is the extension
point for editor rows. Both follow the same shape: declarative entries, one
renderer.

## Error Handling

- Color picker: HTML-native, returns valid hex. No validation needed.
- Font input: free-form text. Invalid font strings just fail to render —
  matches the existing behavior of the JSON-installed themes path. No new
  error surface.
- Persistence failures bubble through the existing `persist()` warning path in
  `settings.ts`. No new UI required.

## Testing

Unit tests (Vitest):

- `overrides.test.ts`
  - `setVariable` then `getOverrides` returns the value.
  - `resetVariable` removes the key.
  - `resetVariable` on the last override for a theme removes the theme entry.
  - `resetTheme` clears all overrides for that theme only.
  - `subscribe` listener fires on each mutation; unsubscribe stops it.
  - `hydrateOverrides` replaces in-memory state.
- `applyTheme.test.ts` (new)
  - With no overrides, applies base values.
  - With overrides set, merged values win on conflicting keys.
  - Variables only present in overrides are applied (defensive).
- `settings.test.ts` (extend existing if present, else add)
  - Round-trips `themeOverrides` through persist → load.
  - Missing `themeOverrides` field loads as `{}`.

Manual smoke (UI):

- Hover a theme card → pen icon visible. Click → editor opens.
- Edit `--bg` on the active theme → background changes immediately, including
  Monaco editor.
- Per-variable reset disables when no override; clears value on click.
- "Reset all" disables when no overrides; clears all on click.
- Restart app → overrides persist.
- Edit an inactive theme → no visual change; activate it → overrides apply.

## Implementation Order (preview for plan)

1. `overrides.ts` + tests.
2. `variableSchema.ts`.
3. Modify `applyTheme.ts` to merge; add tests.
4. Extend `PersistedSettings` + `loadSettings` + persist subscription wiring.
5. `ThemeEditor` component.
6. Wire pen-icon action and view-swap into `ThemeSection`.
7. Manual smoke + harness re-deploy is N/A here (no `runner/` changes).
