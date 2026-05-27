# UI design system refactor — primitives, tokens, and component extraction

## Problem

The UI layer has accumulated inline JSX and `style={{…}}` objects faster than shared primitives. Concrete signals:

- 148 inline `style={{…}}` usages across 19 component files
- Several files have grown past their natural boundaries: `App.tsx` 490L, `ResultsPanel.tsx` 473L, `AIChatPanel.tsx` 422L, `ConnectionPanel.tsx` 334L, `EditorArea.tsx` 312L
- Repeating UI shapes — panel headers, side-docked panels, modal shells, toolbar rows, list rows, form fields, icon buttons — are re-implemented in each file instead of composed from shared primitives
- Color/spacing tokens exist as CSS variables in `globals.css` but are accessed by ad-hoc string literals embedded in JS objects, so design consistency is enforced by copy-paste rather than by a typed surface

Effects: hard to keep visual rhythm consistent, hard to change a primitive globally (e.g., dialog padding), large files are harder to reason about and edit reliably, and any new feature tends to re-roll the same shapes.

This refactor does not add features and does not change behavior. It introduces a small design-system layer, deletes inline styles, and breaks the largest feature files into composed components.

## Non-goals

- No visual redesign. Pixel output stays the same (within reasonable rounding).
- No CSS-in-JS dependency. No Tailwind. No new design library.
- No state-management changes. Stores (`useResultsStore`, `useAIStore`, etc.) are not touched.
- No behavior changes in business logic (DB calls, IPC, AI service layer, keyboard service, record action registry).
- Plugin system, settings system, shortcuts system, and themes system are out of scope.

## Solution

Three layers, applied in order:

1. **Design tokens** — promote CSS variables in `globals.css` to a dedicated `tokens.css`, add semantic tokens (spacing, radius, font-size scales) on top of the existing color tokens. No JS access to raw color strings — components use CSS variables only.

2. **UI primitives** — a small set of headless-leaning React components under `src/components/ui/` that own all repeated UI shapes. Each primitive lives in its own folder with a `.tsx`, a `.module.css`, an `index.ts` re-export, and (where it makes sense) a `__tests__/` folder. Components are functional, typed, composed via children/slots, and use compound-component pattern where there's natural sub-structure (e.g., `<Dialog.Header />`).

3. **Feature refactors** — migrate hot-spot files to use the primitives, extract inline-rendered sub-trees into local feature components, and delete inline `style={{…}}` in favor of CSS modules + token classes.

The refactor is staged across four PRs so review stays tractable and each step is independently mergeable.

## Architecture

### Directory layout (after)

```
src/
  components/
    ui/                     ← NEW — design system primitives
      Button/
        Button.tsx
        Button.module.css
        index.ts
      IconButton/
      Panel/                ← compound: Panel.Header, Panel.Body, Panel.Footer
      Toolbar/
      Dialog/               ← compound: Dialog.Header, Dialog.Body, Dialog.Footer
      FormField/            ← compound: FormField.Label, FormField.Input, FormField.Error
      ListRow/
      ResizableSplit/       ← replaces ad-hoc split logic (uses existing SplitHandle internals)
      Stack/                ← VStack / HStack with gap token
      Text/                 ← typography primitive (variant: body / mono / dim / error)
    features/               ← NEW — feature components live here (moved from `components/`)
      results/
      ai/
      connections/
      editor/
      saved-scripts/
      layout/
    shared/                 ← kept, but trimmed (KeyboardScopeZone stays; SplitHandle internals move into ResizableSplit)
  styles/
    tokens.css              ← NEW — design tokens (colors, spacing, radii, fontSizes)
    globals.css             ← thin: resets only, imports tokens.css
```

`src/components/ui/` and `src/components/features/` are sibling directories. Existing imports under `src/components/<feature>/` are rewritten to `src/components/features/<feature>/`. This split makes the primitive layer obvious at a glance.

### Token surface (`tokens.css`)

Existing color variables stay. Add:

```css
:root {
  /* spacing (4px base) */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;

  /* radii */
  --radius-sm: 3px; --radius-md: 6px; --radius-lg: 10px;

  /* font sizes */
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px;

  /* z-index scale */
  --z-dialog: 100; --z-dropdown: 80; --z-tooltip: 120;
}
```

Components reference tokens only via CSS variables in `.module.css`. The rule: **no color/spacing literals in `.tsx` files.** A lint rule (eyeball during review for now; ESLint rule deferred) enforces this.

### Primitive contracts

Each primitive is a functional component. No classes. No inheritance. Composition via children + compound sub-components. Polymorphic `as` prop only where it genuinely helps (`Button`, `Text`).

#### `<Button>`

```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}
```

Default variant `secondary`, size `md`. Loading disables the button and shows a spinner in place of `iconLeft`. All styling via `Button.module.css`. Replaces every `<button style={…}>` in the codebase.

#### `<IconButton>`

Square button for toolbar icons. Props: `aria-label` (required), `icon`, `onClick`, `tooltip?`, `pressed?`. Used in `IconRail`, toolbar rows, dialog close buttons.

#### `<Panel>` (compound)

```tsx
<Panel>
  <Panel.Header title="Connections" right={<IconButton …/>} />
  <Panel.Body>…</Panel.Body>
  <Panel.Footer>…</Panel.Footer>
</Panel>
```

`Panel.Body` is flex-1 + scrollable by default. Used for: `ConnectionPanel`, `SavedScriptsPanel`, `AIChatPanel` content area, `ResultsPanel` (post-refactor).

#### `<Toolbar>`

Horizontal flex row with token spacing. Children placed left, `right` slot placed right. Used for context bar, results header, AI chat header.

#### `<Dialog>` (compound)

```tsx
<Dialog open={open} onClose={close} ariaLabel="…">
  <Dialog.Header title="Edit connection" onClose={close} />
  <Dialog.Body>{form}</Dialog.Body>
  <Dialog.Footer>
    <Button variant="ghost" onClick={close}>Cancel</Button>
    <Button variant="primary" onClick={save}>Save</Button>
  </Dialog.Footer>
</Dialog>
```

Built on a portal + backdrop. Focus trap + Escape-to-close + initial-focus management handled inside. Replaces the manual modal shells in `ConnectionDialog`, `HostKeyDialog`, `PassphraseDialog`, `SaveScriptDialog`. `RecordModalShell` is a thin adapter over `Dialog` (it has special keyboard-scope wiring) — kept, but its internals collapse onto `Dialog`.

#### `<FormField>` (compound)

```tsx
<FormField>
  <FormField.Label htmlFor="host">Host</FormField.Label>
  <FormField.Input id="host" value={…} onChange={…} />
  <FormField.Error>Required</FormField.Error>
</FormField>
```

Replaces the hand-built label+input+error blocks in every connection dialog.

#### `<ListRow>`

```tsx
<ListRow selected={…} onClick={…} onContextMenu={…} icon={…}>{label}</ListRow>
```

Owns hover/selected/focus styling. Used in `ConnectionTree`, `SavedScriptsPanel`, `PluginList`, context menu entries.

#### `<ResizableSplit>`

```tsx
<ResizableSplit direction="vertical" initial={250} min={150} max={500}>
  <SidePanel/>
  <Main/>
</ResizableSplit>
```

Encapsulates drag handle + size persistence + min/max constraints. Replaces ad-hoc resize logic spread across `App.tsx` and `AIChatPanel`.

#### `<Stack>` (HStack / VStack)

`gap` token prop (`'sm' | 'md' | 'lg'`), `align`, `justify`. Lets us delete tiny `style={{ display: 'flex', gap: 8 }}` wrappers everywhere.

#### `<Text>`

```tsx
<Text variant="body">…</Text>
<Text variant="mono">…</Text>
<Text variant="dim">…</Text>
<Text variant="error" selectable>…</Text>
```

`variant="error"` is what fixes the secondary motivation behind this refactor — error text in `ResultsPanel` becomes a `<Text variant="error" selectable>` and is consistently styled.

### Headless behavior hooks

Some primitives expose just behavior, no DOM, for cases where styling is bespoke:

- `useDisclosure()` — `{ open, setOpen, toggle, close }` — used by Dialog consumers and menus.
- `useResizable({ initial, min, max })` — used by `ResizableSplit` internally and exposed for non-split resize cases.
- `useFocusTrap(ref)` — used by `Dialog` internally and exposed for any custom modal.

Existing `KeyboardScopeZone` and `useCellSelection` are unchanged.

### Compound component pattern (how it's wired)

Each compound component attaches sub-components as static properties:

```tsx
// Dialog.tsx
function DialogRoot({ children, ...rest }: DialogProps) { … }
function DialogHeader(props: …) { … }
function DialogBody(props: …) { … }
function DialogFooter(props: …) { … }
export const Dialog = Object.assign(DialogRoot, {
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
});
```

Same shape for `Panel` and `FormField`. This matches Radix / shadcn idiom and gives consumers a single import.

## Feature refactors

Each of the four PRs in the rollout (see §Rollout) follows the same recipe per file:

1. Identify repeated shapes in the file.
2. Replace them with primitives + a local feature sub-component if needed.
3. Move all inline `style={{…}}` into a sibling `.module.css`.
4. If the file is now >250 lines, extract sub-trees into co-located components in the same feature folder.

Concretely per file:

- **`ResultsPanel.tsx` (473L → ~200L)**: extract `ResultsToolbar`, `ResultsPagination`, `ConsolePanel`, `ErrorBanner`. Error banner uses `<Text variant="error" selectable>`. Table/JSON view switch becomes a `ViewModeStrategy` registry (mirrors the existing `RecordActionRegistry` pattern).

- **`AIChatPanel.tsx` (422L → ~220L)**: extract `AIChatHeader`, `AIChatMessageList`, `AIChatInput`, `AIChatResizeHandle`. Replace ad-hoc resize with `ResizableSplit` / `useResizable`. Replace inline button styles with `IconButton`.

- **`App.tsx` (490L → ~250L)**: extract `AppShell` (the chrome around the three panes), `AppContextProviders` (collect provider wrapping), and `AppKeyboardWiring` (the keyboard service init). Top-level layout uses `ResizableSplit`.

- **`ConnectionPanel.tsx` (334L → ~200L)**: extract `ConnectionPanelHeader`, `ConnectionSearchBar`. Use `Panel` + `ListRow` (already partially modeled by `ConnectionTree`).

- **Dialogs (`ConnectionDialog`, `HostKeyDialog`, `PassphraseDialog`, `SaveScriptDialog`)**: each replaces its manual shell with `<Dialog>` + `<FormField>`. Average shrinkage ~40%. `ConnectionDialog.tsx` (152L, 22 inline styles) is the biggest win.

- **`EditorArea.tsx`, `SavedScriptsPanel.tsx`, `ContextBar.tsx`, `IconRail.tsx`**: same recipe, smaller wins.

## Extensibility contract (for future features)

Per the project's CLAUDE.md extensibility rules, each primitive published in `src/components/ui/` is open for extension by composition:

- New button styles: add a variant to `Button.module.css` + extend the `variant` union. No new file, no `if/else` branches anywhere else.
- New dialog shapes: compose `Dialog.Header/Body/Footer` differently — don't add props to `Dialog` itself.
- New result view modes (Table / JSON / future Tree, Chart, …): register a `ResultViewStrategy` in the `ViewModeRegistry`. No edits to `ResultsPanel`.
- New form input kinds: add a `FormField.<Kind>` sub-component (`FormField.Select`, `FormField.Textarea`, …). The compound stays open.

Each primitive's `index.ts` has a top-of-file comment naming the extension point: *"to add a new variant, …"*

## Error handling and edge cases

- **Theming**: existing theme system reads CSS variables. Tokens move to `tokens.css` but the variables it defines are a superset of today's variables, so the theme system keeps working. The theme system gets one new file to know about, no behavior change.
- **Monaco editor**: `ScriptEditor` and `JsonRecordEditor` are not touched. They already encapsulate Monaco well. They keep their own styling files.
- **Plugins**: `src/plugins/ui/` keeps its own list rendering (out of scope), but in a follow-up it can be migrated to `ListRow`. The primitives are exported from `src/components/ui/`, so plugins can opt in later.
- **Tests**: existing component tests under `src/components/**/__tests__/` and `src/__tests__/` continue to pass. New primitives get a minimum-viable test (renders + key interaction) under their own `__tests__/` folder. Vitest config does not change.
- **Storybook / preview**: none today, not adding one.

## Rollout

Four PRs, in order. Each is independently mergeable and visually a no-op.

**PR 1 — Foundations** (`tokens.css`, primitives, no consumer changes)
- Add `src/styles/tokens.css` and reference it from `globals.css`.
- Add `src/components/ui/` with: `Button`, `IconButton`, `Panel`, `Toolbar`, `Dialog`, `FormField`, `ListRow`, `ResizableSplit`, `Stack`, `Text`, and the headless hooks.
- Minimum-viable tests per primitive.
- Move `SplitHandle` internals into `ResizableSplit`; keep `SplitHandle.tsx` as a thin re-export (deleted in PR 2).
- No feature files touched. No visual change.

**PR 2 — Dialogs and ResultsPanel**
- Move `src/components/<feature>/` → `src/components/features/<feature>/` (mechanical rename + import rewrite).
- Migrate all four dialogs to `<Dialog>` + `<FormField>`. Delete `SplitHandle.tsx` shim.
- Refactor `ResultsPanel.tsx` into `ResultsToolbar`, `ResultsPagination`, `ConsolePanel`, `ErrorBanner`. Introduce `ViewModeRegistry`.
- Verify table cell behavior, modal keyboard scope, error text selectability (Cmd+C works after the Phase 1 menu fix — this PR doesn't regress it).

**PR 3 — Chat panel and app shell**
- Refactor `AIChatPanel.tsx` into `AIChatHeader`, `AIChatMessageList`, `AIChatInput`, using `ResizableSplit` for width.
- Refactor `App.tsx` into `AppShell`, `AppContextProviders`, `AppKeyboardWiring`. Use `ResizableSplit` for primary layout.
- Refactor `ConnectionPanel.tsx`.

**PR 4 — Remaining feature files**
- `EditorArea.tsx`, `SavedScriptsPanel.tsx`, `ContextBar.tsx`, `IconRail.tsx`, `StatusBar.tsx`, `SidePanel.tsx`.
- Final sweep for any remaining `style={{…}}` in feature files. Target: 0 inline color/spacing literals; layout-only inline styles (e.g., `style={{ width: pixelValue }}`) are allowed only when the value is dynamic at runtime.

## Acceptance

When all four PRs are merged:

- `git grep -nE 'style=\{\{' src/components/features/ | wc -l` returns < 20 (only dynamic-pixel cases).
- `git grep -nE 'color:|background:|padding:|margin:' src/components/features/` returns 0 matches inside JSX.
- No file in `src/components/features/` exceeds 280 lines.
- All existing vitest suites pass.
- Manual smoke: open app, connect, run query, view results table + JSON, open record modal F3, edit record F4, open all dialogs, open AI chat, resize panels, switch theme. Visual output matches pre-refactor screenshots.
- Cmd+C still works on error text and table cells (Phase 1 fix preserved).

## Out of scope (explicitly deferred)

- Storybook / component catalog.
- ESLint rule banning inline color literals (manual review for now).
- Tailwind / CSS-in-JS migration.
- Plugin-side UI migration.
- Visual redesign of any feature.
- Settings UI refactor (it's mostly fine already).
