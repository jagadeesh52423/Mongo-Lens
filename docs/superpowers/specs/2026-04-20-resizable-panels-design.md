# Resizable Panels Design

**Date:** 2026-04-20  
**Scope:** Two resizable splits — sidebar width (global) and editor/results height (per-tab)

---

## Overview

Add drag-to-resize capability to two areas of the app using `react-resizable-panels`:

1. **Sidebar ↔ Main area** — horizontal split, global (shared across all tabs)
2. **Editor ↔ Results** — vertical split, per-tab (each tab remembers its own ratio independently)

Constraints: 20% minimum height for each panel in the vertical split. Split positions reset on app restart (in-memory only, no disk persistence).

---

## Architecture

- Add `react-resizable-panels` as the single new dependency
- `App.tsx` gains a horizontal `PanelGroup` wrapping `SidePanel` + `EditorArea`, replacing the current fixed sidebar layout
- `EditorArea.tsx` gains a vertical `PanelGroup` per active tab wrapping `ScriptEditor` + `ResultsPanel`
- Zustand `editor` store gains `panelSizes` to track per-tab editor/results ratios
- Sidebar width is global — managed as local `useState` in `App.tsx`, no Zustand needed

---

## Components

### `<SplitHandle>`

A shared styled component used in both `App.tsx` (horizontal) and `EditorArea.tsx` (vertical).

- Renders a thin line with a centered grip indicator (3 dots or short line)
- Uses `--accent` (MongoDB green) on hover
- Passed as `<PanelResizeHandle>` child

### `App.tsx`

Replaces current flex row with:

```tsx
<PanelGroup direction="horizontal">
  <Panel minSize={10} defaultSize={20}>
    <SidePanel />
  </Panel>
  <SplitHandle direction="horizontal" />
  <Panel minSize={50}>
    <EditorArea />
  </Panel>
</PanelGroup>
```

Sidebar width is not persisted. Existing collapse button uses `panel.collapse()` / `panel.expand()` from a panel ref.

### `EditorArea.tsx`

For the active tab, renders:

```tsx
<PanelGroup direction="vertical" onLayout={(sizes) => setPanelSizes(tabId, sizes)}>
  <Panel minSize={20} defaultSize={panelSizes[tabId]?.[0] ?? 60}>
    <ScriptEditor />
  </Panel>
  <SplitHandle direction="vertical" />
  <Panel minSize={20} defaultSize={panelSizes[tabId]?.[1] ?? 40}>
    <ResultsPanel />
  </Panel>
</PanelGroup>
```

---

## State Management

### Zustand `editor` store additions

```ts
panelSizes: Record<string, [number, number]>  // tabId → [editorPercent, resultsPercent]

setPanelSizes(tabId: string, sizes: [number, number]): void
initPanelSizes(tabId: string): void  // sets default [60, 40] on new tab creation
removePanelSizes(tabId: string): void  // called on tab close, prevents memory leak
```

### Data flow

1. New tab created → `initPanelSizes(tabId)` sets `[60, 40]`
2. User drags divider → `onLayout` fires → `setPanelSizes(tabId, sizes)` updates store
3. User switches tabs → `EditorArea` reads `panelSizes[activeTabId]` and passes as `defaultSize`
4. Tab closed → `removePanelSizes(tabId)` cleans up store entry
5. App restart → store resets, all tabs start at `[60, 40]`

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| New tab, no saved sizes | Defaults to `[60, 40]` via `initPanelSizes` |
| Tab closed | `removePanelSizes` removes entry to prevent memory leak |
| No query run yet (empty results) | Results panel renders empty state at whatever size; no special handling |
| Window resize | `react-resizable-panels` scales proportionally (percentage-based) |
| Sidebar collapse button | Uses panel imperative API: `panelRef.current.collapse()` / `.expand()` |

---

## Files Changed

| File | Change |
|---|---|
| `package.json` | Add `react-resizable-panels` |
| `src/App.tsx` | Wrap layout in horizontal `PanelGroup` |
| `src/store/editor.ts` | Add `panelSizes`, `setPanelSizes`, `initPanelSizes`, `removePanelSizes` |
| `src/components/editor/EditorArea.tsx` | Wrap editor+results in vertical `PanelGroup` per tab |
| `src/components/shared/SplitHandle.tsx` | New shared handle component (new file) |
