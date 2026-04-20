# Tab Keyboard Shortcuts — Design Spec

**Date:** 2026-04-20  
**Status:** Approved

---

## Overview

Add keyboard shortcuts for tab navigation and management. All shortcuts are user-remappable via the existing Settings → Shortcuts UI. The design follows the established `useTableActions` pattern — a declarative action array registered through a dedicated hook.

---

## Shortcuts

| ID | Default Keys | Action |
|---|---|---|
| `tab.next` | Ctrl+Tab | Activate next tab (wraps around) |
| `tab.prev` | Ctrl+Shift+Tab | Activate previous tab (wraps around) |
| `tab.close` | Ctrl+W | Close the active tab |
| `tab.new` | Ctrl+T | Open a new untitled tab |
| `tab.goTo.1`…`tab.goTo.9` | Ctrl+1…Ctrl+9 | Jump to tab at that 1-based index (no-op if out of range) |

---

## Architecture

### New file: `src/hooks/useTabActions.ts`

A single hook that owns all tab shortcut registration. Structure:

```typescript
// Static shortcuts — add new tab shortcuts here
const TAB_ACTIONS: Array<Omit<ShortcutDef, 'action'>> = [
  { id: 'tab.next',  keys: { ctrl: true, key: 'Tab' },              label: 'Next Tab' },
  { id: 'tab.prev',  keys: { ctrl: true, shift: true, key: 'Tab' }, label: 'Previous Tab' },
  { id: 'tab.close', keys: { ctrl: true, key: 'w' },                label: 'Close Tab' },
  { id: 'tab.new',   keys: { ctrl: true, key: 't' },                label: 'New Tab' },
];

// Index shortcuts — generated from indices 1..9
// id: 'tab.goTo.N', keys: { ctrl: true, key: 'N' }, label: 'Go to Tab N'
```

The hook:
- Reads `tabs`, `activeTabId`, `setActive`, `closeTab`, `openTab` from `useEditorStore`
- Captures live state in a `stateRef` (same stale-closure pattern as `useTableActions`)
- Calls `useKeyboard` for each entry in `TAB_ACTIONS` plus each generated index shortcut
- All shortcuts have **no scope** — they fire globally regardless of active pane

### Mount point

One line added to `EditorArea.tsx` (inside the component body):

```tsx
useTabActions();
```

### No other files change

`KeyboardService`, `useKeyboard`, the Zustand store, and the Settings Shortcuts UI all work without modification. Tab shortcuts appear automatically in the remapping UI because `KeyboardService.getShortcuts()` returns all registered definitions.

---

## Action Behaviours

**`tab.next` / `tab.prev`**: Find index of `activeTabId` in `tabs`, increment/decrement with modulo wrap.

**`tab.close`**: Call `closeTab(activeTabId)`. The store already handles activation of the next remaining tab on close.

**`tab.new`**: Call `openTab(...)` with a fresh untitled `EditorTab` (same payload as the existing `+ New` button).

**`tab.goTo.N`**: If `tabs[N-1]` exists, call `setActive(tabs[N-1].id)`. Otherwise no-op.

---

## Files Changed

| File | Change |
|---|---|
| `src/hooks/useTabActions.ts` | **New** — hook with all tab shortcut definitions |
| `src/components/editor/EditorArea.tsx` | Add `useTabActions()` call inside component |

---

## Extensibility

To add a new tab shortcut in the future, add one object to `TAB_ACTIONS` in `useTabActions.ts`. The action wiring, settings UI registration, and remapping support are automatic.
