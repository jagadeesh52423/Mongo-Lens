# KeyboardScopeZone — Declarative Keyboard Scope Management

**Date:** 2026-04-23

## Problem

`KeyboardService` uses a single `_activeScope` to gate which shortcuts fire. Previously every panel was responsible for calling `keyboardService.setScope()` imperatively — via `onMouseDown` or `onFocus` handlers. This is easy to forget: the `AIChatPanel` bug (Cmd+C copying from results while in the AI pane) was caused by exactly this omission.

The failure mode is silent and non-obvious: the wrong shortcuts fire in an unrelated pane.

## Goal

Make scope management declarative and automatic. A panel declares what scope it represents by wrapping its content in `<KeyboardScopeZone scope="results">`. Everything outside a zone safely clears to `''`, so unscoped panels can never accidentally inherit a stale scope.

## Architecture

### `KeyboardScopeZone` component

**File:** `src/components/shared/KeyboardScopeZone.tsx`

```tsx
<KeyboardScopeZone scope="results" style={{ height: '100%' }}>
  <ResultsPanel ... />
</KeyboardScopeZone>
```

Renders a `div` with:
- `onMouseDown` → `svc.setScope(scope)` — covers mouse clicks anywhere inside, including non-focusable areas
- `onFocus` → `svc.setScope(scope)` — covers keyboard Tab navigation (React's `onFocus` bubbles, fires for any focused child)
- `data-keyboard-scope={scope}` — traceability only, no logic depends on it

Props: `scope: string`, `children: ReactNode`, `style?: CSSProperties`.

Uses `useKeyboardService()` to access the service — consistent with existing codebase pattern.

### Global scope-clear listener in `App.tsx`

A `window` mousedown listener registered in the **capture phase** clears the scope to `''` before any React bubble-phase handler runs:

```tsx
useEffect(() => {
  const clear = () => keyboardService.setScope('');
  window.addEventListener('mousedown', clear, { capture: true });
  return () => window.removeEventListener('mousedown', clear, { capture: true });
}, []);
```

**Event ordering for a click inside a zone:**
1. Capture: global listener → `setScope('')`
2. Bubble: zone's `onMouseDown` → `setScope('results')` ← wins

**Event ordering for a click outside any zone:**
1. Capture: global listener → `setScope('')`
2. No zone `onMouseDown` fires
3. Net: `''`

No `stopPropagation` needed anywhere. No changes to `KeyboardService`.

## Migration

Three files change — all removing manual `setScope` calls:

### `EditorArea.tsx`
- Remove `useActivateScope` import and both `activateEditor` / `activateResults` calls
- Replace wrapper divs with `KeyboardScopeZone`:

```tsx
// editor panel
<KeyboardScopeZone scope="editor" style={{ height: '100%' }}>
  <ScriptEditor ... />
</KeyboardScopeZone>

// results panel
<KeyboardScopeZone scope="results" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
  <ResultsPanel ... />
</KeyboardScopeZone>
```

### `TableView.tsx`
- Remove `onFocus={() => keyboardService.setScope('results')}` from the container div
- The parent `KeyboardScopeZone` in `EditorArea` covers this

### `AIChatPanel.tsx`
- Remove `onMouseDown={() => keyboardService.setScope('')}` and the `keyboardService` import added in the immediate hotfix
- The global capture listener handles it

## Invariants After This Change

- Every future panel gets correct scope behaviour by wrapping in `<KeyboardScopeZone scope="...">` — no other wiring needed
- Panels with no zone wrapper are safe: any click clears scope to `''`, preventing stale scope leaks
- Adding a new scope requires zero changes to existing code — only a new zone wrapper and shortcut definitions

## Files Changed

| File | Change |
|------|--------|
| `src/components/shared/KeyboardScopeZone.tsx` | New component |
| `src/App.tsx` | Add global capture mousedown listener |
| `src/components/editor/EditorArea.tsx` | Replace manual scope calls with zone wrappers |
| `src/components/results/TableView.tsx` | Remove manual `onFocus` scope call |
| `src/components/ai/AIChatPanel.tsx` | Revert hotfix; zone handles it |
| `src/services/KeyboardService.ts` | Remove `useActivateScope` (dead code after migration) |
