# Results Pane — Arrow Key Cell Navigation

**Date:** 2026-04-20  
**Status:** Approved

## Overview

When a user clicks a cell in the results pane, they can navigate to adjacent cells using the arrow keys (Up/Down = rows, Left/Right = columns). Navigation stops at table boundaries. The view auto-scrolls to keep the selected cell visible.

## Goals

- All 4 arrow keys navigate between cells
- Navigation stops at boundaries (no wrap-around)
- Table auto-scrolls to keep selected cell in view
- Arrow keys do not scroll the browser page when a cell is selected

## Non-Goals

- Multi-cell (shift+arrow) selection
- Keyboard-driven editing
- Column reordering via keyboard

## Architecture

No new files. Three small changes to existing files.

### 1. `TableView.tsx` — Tag cells with data attributes

Add `data-row` and `data-col` to every `<td>` so navigation actions can find the DOM element for scroll targeting:

```tsx
<td
  data-row={rowIndex}
  data-col={colKey}
  ...
>
```

### 2. `useTableActions.ts` — Register arrow key actions

Accept two new ref parameters:

```ts
docsRef: React.MutableRefObject<Record<string, unknown>[]>
columnsRef: React.MutableRefObject<string[]>
```

Register 4 new actions (alongside existing copy/view/edit actions):

| Action ID           | Key       | Context menu |
|---------------------|-----------|--------------|
| `cell.navigateUp`   | ArrowUp   | false        |
| `cell.navigateDown` | ArrowDown | false        |
| `cell.navigateLeft` | ArrowLeft | false        |
| `cell.navigateRight`| ArrowRight| false        |

Each action:
1. Guard: if no cell selected, no-op
2. Compute next `rowIndex` / `colKey` (clamped at boundaries)
3. Call `select(nextRow, nextCol, nextDoc, nextValue)` via context
4. Call `e.preventDefault()` to suppress browser scroll
5. Find `document.querySelector([data-row="${r}"][data-col="${c}"])` and call `.scrollIntoView({ block: 'nearest', inline: 'nearest' })`

### 3. `ResultsPanel.tsx` — Pass refs into hook

Derive `columnsRef` from the docs (columns are already computed here). Pass both into `useTableActions`:

```ts
const docsRef = useRef(docs)
const columnsRef = useRef(columns)
// keep refs current on each render
useEffect(() => { docsRef.current = docs }, [docs])
useEffect(() => { columnsRef.current = columns }, [columns])

useTableActions(svc, stateRef, docsRef, columnsRef)
```

## Data Flow

```
KeyDown (ArrowKey)
  → TableView onKeyDown → keyboardService.dispatch(e)
  → cell.navigateX action handler
  → read stateRef (selected cell) + docsRef + columnsRef
  → clamp next {rowIndex, colKey} at boundaries
  → select(nextRow, nextCol, nextDoc, nextValue)
  → querySelector([data-row][data-col]).scrollIntoView({ block: nearest, inline: nearest })
```

## Behavior

- Arrow keys only activate when a cell is selected
- At row 0, ArrowUp is a no-op; at last row, ArrowDown is a no-op
- At first column, ArrowLeft is a no-op; at last column, ArrowRight is a no-op
- `scrollIntoView({ block: 'nearest', inline: 'nearest' })` only scrolls if the cell is out of view — no jarring jumps when already visible
- Arrow keys are not shown in the right-click context menu

## Files Changed

| File | Change |
|------|--------|
| `src/components/results/TableView.tsx` | Add `data-row` / `data-col` to `<td>` |
| `src/hooks/useTableActions.ts` | Accept `docsRef`/`columnsRef`, register 4 arrow key actions |
| `src/components/results/ResultsPanel.tsx` | Derive `columnsRef`, pass both refs into `useTableActions` |
