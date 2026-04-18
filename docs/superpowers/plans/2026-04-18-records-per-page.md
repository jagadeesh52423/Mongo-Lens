# Records Per Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a page-size selector (5/10/20/50/100/200, default 50) to the ResultsPanel pagination bar; selection is per-tab and session-only.

**Architecture:** `pageSize` lives as local React state in `ResultsPanel`. The `onPageChange` callback is updated to carry both `page` and `pageSize`, so `EditorArea` can forward both to `runScript`. Changing page size resets to page 0 and re-runs immediately.

**Tech Stack:** React 18 (useState), TypeScript, Tauri v2

---

## File Map

| File | Change |
|------|--------|
| `src/components/results/ResultsPanel.tsx` | Add `pageSize` state, `PAGE_SIZE_OPTIONS` constant, `<select>` dropdown in pagination bar, update all `onPageChange` call sites |
| `src/components/editor/EditorArea.tsx` | Update `handleRun` signature to accept `pageSize`, update `runScript` call, update `onPageChange` prop on `<ResultsPanel>` |

---

### Task 1: Update `ResultsPanel` — pageSize state, dropdown, callback signature

**Files:**
- Modify: `src/components/results/ResultsPanel.tsx`

- [ ] **Step 1: Add `PAGE_SIZE_OPTIONS` constant and `pageSize` state**

  Replace the top of the component (lines 1–21 of the current file) with:

  ```tsx
  import { useEffect, useMemo, useState } from 'react';
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import { useResultsStore } from '../../store/results';
  import { JsonView } from './JsonView';
  import { TableView } from './TableView';
  import { toCsv, toJsonText } from '../../utils/export';

  const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 200] as const;

  interface Props {
    tabId: string;
    onPageChange?: (page: number, pageSize: number) => void;
  }

  export function ResultsPanel({ tabId, onPageChange }: Props) {
    const res = useResultsStore((s) => s.byTab[tabId]);
    const [view, setView] = useState<'json' | 'table'>('json');
    const [pageSize, setPageSize] = useState(50);
    const pagination = res?.pagination;
    const totalPages = pagination && pagination.total >= 0
      ? Math.max(1, Math.ceil(pagination.total / pageSize))
      : -1;
  ```

  Note: `totalPages` now uses local `pageSize` (not `pagination.pageSize`) so the page count preview updates immediately when the user changes the dropdown.

- [ ] **Step 2: Update `handlePageInputKey` to pass `pageSize`**

  Find this function (currently around line 41) and replace it:

  ```tsx
  function handlePageInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const parsed = parseInt(String(inputPage), 10);
    if (isNaN(parsed)) return;
    const clamped = Math.max(1, totalPages > 0 ? Math.min(parsed, totalPages) : parsed);
    setInputPage(clamped);
    onPageChange?.(clamped - 1, pageSize); // convert to 0-indexed
  }
  ```

- [ ] **Step 3: Update Prev and Next button `onClick` to pass `pageSize`**

  Find the Prev button `onClick` (currently line 100) and update:
  ```tsx
  onClick={() => onPageChange?.(pagination.page - 1, pageSize)}
  ```

  Find the Next button `onClick` (currently line 120) and update:
  ```tsx
  onClick={() => onPageChange?.(pagination.page + 1, pageSize)}
  ```

- [ ] **Step 4: Add the page-size `<select>` dropdown to the pagination bar**

  Inside the `{pagination && (` block, after the Next button (currently line 124) and before `</div>`, add:

  ```tsx
          <select
            value={pageSize}
            onChange={(e) => {
              const next = Number(e.target.value);
              setPageSize(next);
              onPageChange?.(0, next);
            }}
            disabled={res.isRunning}
            style={{ marginLeft: 'auto' }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>per page</span>
  ```

- [ ] **Step 5: Verify the file compiles with no TypeScript errors**

  ```bash
  cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp
  npx tsc --noEmit
  ```

  Expected: no errors related to `ResultsPanel.tsx`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/results/ResultsPanel.tsx
  git commit -m "feat(ui): add per-page selector to ResultsPanel pagination bar"
  ```

---

### Task 2: Update `EditorArea` — forward `pageSize` through `handleRun`

**Files:**
- Modify: `src/components/editor/EditorArea.tsx`

- [ ] **Step 1: Update `handleRun` signature and `runScript` call**

  Find `handleRun` (currently line 19) and replace it:

  ```tsx
  async function handleRun(page = 0, pageSize = 50) {
    if (!active || active.type !== 'script') return;
    const connId = active.connectionId ?? activeConnectionId;
    const db = active.database ?? activeDatabase;
    if (!connId || !db) {
      alert('Select a connection and database first');
      return;
    }
    console.log('[handleRun] tabId:', active.id, 'connId:', connId, 'db:', db, 'page:', page, 'pageSize:', pageSize);
    startRun(active.id);
    try {
      await runScript(active.id, connId, db, active.content, page, pageSize);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[handleRun] runScript failed:', msg);
      setError(active.id, msg);
      finishRun(active.id, 0);
    }
  }
  ```

- [ ] **Step 2: Update the `onPageChange` prop on `<ResultsPanel>`**

  Find the `<ResultsPanel>` usage (currently line 118) and update:

  ```tsx
  <ResultsPanel tabId={active.id} onPageChange={(page, pageSize) => handleRun(page, pageSize)} />
  ```

- [ ] **Step 3: Verify the file compiles with no TypeScript errors**

  ```bash
  cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/editor/EditorArea.tsx
  git commit -m "feat(editor): forward pageSize from ResultsPanel through handleRun"
  ```

---

### Task 3: Manual smoke test

- [ ] **Step 1: Start the app**

  ```bash
  cd /Users/jagadeeshpulamarasetti/OwnCode/MongoMacApp
  npm run tauri dev
  ```

- [ ] **Step 2: Run a script against a collection with > 50 docs**

  Open a script tab, connect, and run:
  ```js
  db.yourCollection.find({})
  ```

  Expected: pagination bar appears at the bottom of the results panel. Dropdown shows `50` selected. Page shows `Page 1 of N`.

- [ ] **Step 3: Change page size to 10**

  Select `10` from the dropdown.

  Expected: query re-runs immediately, results update to 10 docs, page count recalculates (`of N` increases).

- [ ] **Step 4: Navigate to page 2 then change page size to 100**

  Click Next to go to page 2, then change dropdown to `100`.

  Expected: resets to page 1 with 100 docs shown.

- [ ] **Step 5: Verify dropdown is disabled while running**

  Click Run and immediately check the dropdown.

  Expected: dropdown is greyed out / not interactive while `Running…` is shown.

- [ ] **Step 6: Open a second tab and confirm page size is independent**

  Open a new script tab, run the same query.

  Expected: dropdown is back to `50` (default), independent of what the first tab had selected.
