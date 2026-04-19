# Context Bar — Design Spec

**Date:** 2026-04-19
**Status:** Approved

## Problem

When a user opens a new tab via "+ New" and runs a script, they see `alert('Select a connection and database first')` because the tab has no `connectionId` or `database` set. There is no UI on the tab itself to set these — the only way to get a pre-filled tab is by clicking a collection in the connection tree sidebar. This is a dead-end UX for free-form scripting.

## Solution

Add a **persistent context bar** between the tab strip and the Monaco editor. It contains two dropdowns — connection and database — that set the execution context for the current tab. The `alert()` is removed entirely.

## Behaviour

### Dropdowns

- **Connection dropdown** — lists only currently-connected connections (those in `connectedIds` from the connections Zustand store). Not all saved connections, only live ones.
- **Database dropdown** — lists the databases for the selected connection (same data already loaded into `ConnectionTree`). Activates only after a connection is selected.
- Both dropdowns are **reactive**: if the user connects a new connection in the sidebar while a tab is open, it appears in the dropdown immediately without any page action.

### Auto-fill on new tab

When a new tab is opened (via "+ New"), the context bar **auto-fills** with the current global active connection and database (`activeConnectionId` / `activeDatabase` from the connections store), if they exist. This matches the existing fallback logic in `handleRun` and eliminates friction for the common case.

### Per-tab persistence

Each tab independently tracks its own `connectionId` and `database`. Changing the dropdown on one tab does not affect other tabs. Switching tabs restores that tab's last-selected context. This is stored in the existing `EditorTab` shape in the editor Zustand store — no schema changes needed.

### Run button

The Run button moves into the context bar (right-aligned), grouping "run on [connection] / [database] → ▶ Run" as one logical unit. The `alert()` in `handleRun` is replaced by disabling the Run button when either dropdown is empty.

### States

| State | Connection dropdown | Database dropdown | Run button |
|---|---|---|---|
| Connected connection + db active | Shows active connection (selected) | Shows active db (selected) | Enabled |
| No connections connected | "No connections — connect in sidebar" (grayed, disabled) | Hidden or grayed | Disabled |
| Connection selected, no db picked | Shows selected connection | "Pick a database…" | Disabled |
| All set | Selected connection | Selected database | Enabled |

## Files Affected

| File | Change |
|---|---|
| `src/components/editor/EditorArea.tsx` | Add `<ContextBar>` between tab strip and editor; remove `alert()`; move Run button into ContextBar; wire dropdowns to tab state |
| `src/components/editor/ContextBar.tsx` | New component — renders connection + database dropdowns and Run button |
| `src/store/editor.ts` | `openTab()` auto-fills `connectionId` + `database` from active store values; `updateTab()` used to persist dropdown changes |
| `src/store/connections.ts` | No changes needed — `connectedIds`, `activeConnectionId`, `activeDatabase` already exist |
| `src/ipc.ts` | No changes needed — `listDatabases(connectionId)` already exists |

## Component: ContextBar

```
<ContextBar
  tabId: string
  connectionId: string | undefined        // current tab's value
  database: string | undefined            // current tab's value
  onConnectionChange: (id: string) => void
  onDatabaseChange: (db: string) => void
  onRun: () => void
  isRunning: boolean
/>
```

Internally reads `connectedIds` and connection list from `useConnectionsStore` to populate the connection dropdown. Calls `listDatabases(connectionId)` (IPC) when connection changes to populate the database dropdown. Caches databases per connectionId to avoid redundant IPC calls.

## Out of Scope

- Collection selector (not required; collection is specified directly in the script)
- Auto-connecting a disconnected connection from the bar (connect/disconnect remains in the sidebar)
- Saving context with a named script (the saved-scripts feature already handles this separately)
