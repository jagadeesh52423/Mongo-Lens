# Keybinding UI — Design Spec

**Date:** 2026-04-21  
**Status:** Approved

---

## Problem

The Shortcuts settings page (`ShortcutsSection.tsx`) already has rebinding UI code, but it is broken: shortcuts are registered via component lifecycle (`mount`/`unmount`), so when the settings page opens and the editor components unmount, their shortcuts unregister. The settings page then sees only the globally-registered "Open Settings" shortcut.

---

## Goal

Users can view all shortcuts grouped by scope, rebind any shortcut individually, reset an individual shortcut to its default, and reset all shortcuts at once with a single button.

---

## Architecture

### Core Principle: Separate Definition from Handler

`KeyboardService` maintains two independent registries:

| Registry | Lifetime | Purpose |
|---|---|---|
| `definitions: Map<id, ShortcutDefinition>` | Permanent (module load) | Source of truth for settings page |
| `handlers: Map<id, () => void>` | Ephemeral (component lifecycle) | Dispatch — only active when component is mounted |

Adding a new shortcut in the future requires:
1. Add entry to `src/shortcuts/defaults.ts`
2. Call `defineShortcut()` at module level (imports the entry)
3. Call `register(id, handler)` inside your hook/component
4. Zero changes to anything else

### New `KeyboardService` API

```typescript
// Permanent — call once at module load, survives unmount
defineShortcut(def: ShortcutDefinition): void

// Ephemeral — call in hook/component, returns cleanup
register(id: string, handler: () => void): () => void

// Settings page reads from here (not getShortcuts())
getDefinitions(): ShortcutDefinition[]

// Dispatch reads active handlers only (unchanged behaviour)
dispatch(event: KeyboardEvent): void
```

`getShortcuts()` is kept for internal dispatch use but the settings page migrates to `getDefinitions()`.

---

## Scope-Aware Bindings

Each `ShortcutDefinition` carries a `scope: string` field — either `"global"` or a panel name (e.g., `"results"`). Scopes are open-ended strings; new scopes self-register by being used.

**Conflict detection during rebind:** checks only within the same scope. Two shortcuts in different scopes may share the same key combo without conflict.

**Dispatch:** already scope-aware — only fires shortcuts whose scope matches the active scope. No change needed.

**Override storage:** `Record<shortcutId, string>` (unchanged). Since each shortcut `id` is unique (e.g., `"copy-cell"` vs `"copy-global"`), scope is implicit in the id. No structural change to the Zustand store.

---

## Defaults File

`src/shortcuts/defaults.ts` — pure data, no logic. Contains all `ShortcutDefinition` objects with their original key combos. This is the single source of truth for defaults.

```typescript
// implement this interface to add a new shortcut variant
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'open-settings', label: 'Open Settings', keys: { cmd: true, ctrl: false, shift: false, alt: false, key: ',' }, scope: 'global' },
  { id: 'new-tab',       label: 'New Tab',        keys: { cmd: false, ctrl: true, shift: false, alt: false, key: 't' }, scope: 'global' },
  // ... all shortcuts
];
```

Each hook/module imports its entries from this file rather than hardcoding combos inline.

---

## Settings Page Changes

### Layout — grouped by scope

```
── Global ──────────────────────────────────
Open Settings       ⌘,
New Tab             ⌃T
...

── Results Pane ────────────────────────────
Copy Cell           ⌘C
Copy Document       ⇧⌘C
...
```

### Reset All button

Placed at the top-right of the Keyboard Shortcuts section. Single click:
1. Calls `resetAllShortcuts()` store action (clears all overrides)
2. Calls `keyboardService.applyOverrides({})` to re-sync active handlers
3. All "custom" badges disappear

### Individual reset

Right-click any row → "Reset to default" (existing behaviour, unchanged).

---

## Files Changed

| File | Change |
|---|---|
| `src/shortcuts/defaults.ts` | **New** — all default `ShortcutDefinition` entries |
| `src/services/KeyboardService.ts` | Add `defineShortcut()`, `getDefinitions()`, split definitions/handlers maps |
| `src/hooks/useTabActions.ts` | Call `defineShortcut()` at module level from defaults |
| `src/hooks/useTableActions.ts` | Call `defineShortcut()` at module level from defaults |
| `src/App.tsx` | Call `defineShortcut()` for `open-settings` |
| `src/settings/sections/ShortcutsSection.tsx` | Use `getDefinitions()`, group by scope, add Reset All button |
| `src/store/settings.ts` | Add `resetAllShortcuts()` store action |

---

## Extension Contract

To add a new shortcut:
1. Add `ShortcutDefinition` to `src/shortcuts/defaults.ts`
2. Call `defineShortcut(entry)` at the top of your module file
3. Call `register(id, handler)` inside your hook for the active handler
4. No other files need changing
