# Scope-Based Shortcut Routing

## Problem

`KeyboardService` dispatches all registered shortcuts via a global `window` keydown listener. `cell.copyValue` is registered with `Cmd+C`, which fires even when Monaco editor has focus. Pressing `Cmd+C` in the script editor copies the selected cell value (if any) to the clipboard instead of the selected editor text.

Arrow key nav shortcuts (`ArrowUp/Down/Left/Right`) have the same issue — they currently intercept cursor movement inside Monaco.

## Solution

Add an **active scope** to `KeyboardService`. Shortcuts declare an optional `scope`; the dispatcher skips them unless that scope is currently active. Panes activate their scope on `mousedown` (explicit activation — stays active until another pane is clicked, matching IDE behaviour).

## Architecture

### `KeyboardService.ts`

**`ShortcutDef` change:**
```ts
interface ShortcutDef {
  // ...existing fields...
  scope?: string; // if set, only fires when KeyboardService._activeScope matches
}
```

**`KeyboardService` additions:**
```ts
private _activeScope = '';

setScope(scope: string): void {
  this._activeScope = scope;
}

getScope(): string {
  return this._activeScope;
}
```

**`dispatch()` guard** — added at the top of the match loop, before any field comparisons:
```ts
if (def.scope && def.scope !== this._activeScope) continue;
```

**New exported hook:**
```ts
export function useActivateScope(scope: string): () => void {
  const svc = useKeyboardService();
  return useCallback(() => svc.setScope(scope), [svc, scope]);
}
```

### `useTableActions.ts`

Add `scope: 'results'` to every entry in `TABLE_ACTIONS` and `NAV_ACTIONS`. No other changes to logic.

Affected shortcut IDs:
- `cell.copyValue`, `cell.copyField`, `cell.copyFieldPath`, `cell.copyDocument`
- `cell.viewRecord`, `cell.editRecord`
- `cell.navigateUp`, `cell.navigateDown`, `cell.navigateLeft`, `cell.navigateRight`

### `EditorArea.tsx`

Call `useActivateScope` for both panes and attach the returned callback to `onMouseDown` on a wrapper div around each panel's content:

```tsx
const activateEditor = useActivateScope('editor');
const activateResults = useActivateScope('results');

// Editor panel content wrapper
<div style={{ height: '100%' }} onMouseDown={activateEditor}>
  <ScriptEditor ... />
</div>

// Results panel content wrapper
<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} onMouseDown={activateResults}>
  <ResultsPanel ... />
</div>
```

The existing `style` on the results wrapper div (`height: '100%', display: 'flex', flexDirection: 'column'`) must be preserved.

## Scope Registry

| Scope string | Pane |
|---|---|
| `'editor'` | ScriptEditor (Monaco) |
| `'results'` | ResultsPanel / TableView |
| `''` (default) | No pane activated yet |

Future panes (`'connections'`, `'saved-scripts'`, `'settings'`) follow the same pattern — call `useActivateScope` and attach `onMouseDown` to their wrapper.

## Global shortcuts

Shortcuts with no `scope` field remain global and fire regardless of active scope. Current global shortcuts: `open-settings` (Cmd+,), `run-query` (Cmd+Enter registered in ScriptEditor via Monaco's own API — unaffected).

## Files Changed

| File | Change |
|---|---|
| `src/services/KeyboardService.ts` | Add `scope?` to `ShortcutDef`; add `_activeScope`, `setScope`, `getScope` to `KeyboardService`; guard in `dispatch`; export `useActivateScope` |
| `src/hooks/useTableActions.ts` | Add `scope: 'results'` to all `TABLE_ACTIONS` and `NAV_ACTIONS` entries |
| `src/components/editor/EditorArea.tsx` | Call `useActivateScope` for editor and results scopes; add `onMouseDown` to panel content wrappers |

## Out of Scope

- Sidebar panes (connections, saved-scripts) do not need scope activation for this fix — no conflicting shortcuts are currently registered for those panes. Wiring them up is deferred until a conflicting shortcut exists.
- Keyboard-driven focus (Tab key) is not handled — scope only changes on `mousedown`. If keyboard navigation between panes is needed in future, `onFocus` can be added to the same wrappers.
