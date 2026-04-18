# Full Record View / Edit Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a centered modal that lets users view or edit a full MongoDB document as JSON, triggered via right-click / F3 (view) or F4 (edit).

**Architecture:** A single `RecordModal` component manages both view and edit modes via internal state. `useCellShortcuts` is extended with optional callbacks that `ResultsPanel` wires to modal state. The right-click context menu picks up "View Full Record" automatically through the existing `KeyboardService` registration pattern.

**Tech Stack:** React 18, TypeScript, Vitest + @testing-library/react, existing `updateDocument` IPC call in `src/ipc.ts`.

---

## File Map

| File | Action |
|------|--------|
| `src/hooks/useCellShortcuts.ts` | Modify — add `CellShortcutsOptions`, F3/F4 shortcuts |
| `src/__tests__/cell-selection-context.test.tsx` | Modify — update counts, add F3/F4 tests |
| `src/components/results/RecordModal.tsx` | **Create** — new modal component |
| `src/__tests__/record-modal.test.tsx` | **Create** — modal tests |
| `src/components/results/ResultsPanel.tsx` | Modify — props, modal state, render RecordModal |
| `src/__tests__/results-panel.test.tsx` | Modify — add modal integration tests |

---

## Task 1: Extend `useCellShortcuts` with F3/F4

**Files:**
- Modify: `src/hooks/useCellShortcuts.ts`
- Modify: `src/__tests__/cell-selection-context.test.tsx`

- [ ] **Step 1.1: Update the failing tests first**

  Open `src/__tests__/cell-selection-context.test.tsx`. Replace these two tests:

  ```ts
  // OLD — replace this:
  it('registers 4 shortcuts', () => {
    const svc = new KeyboardService();
    renderHook(() => useCellShortcuts(svc), { wrapper: makeWrapper(svc) });
    expect(svc.getAll()).toHaveLength(4);
  });

  it('all 4 shortcuts have showInContextMenu: true', () => {
    const svc = new KeyboardService();
    renderHook(() => useCellShortcuts(svc), { wrapper: makeWrapper(svc) });
    expect(svc.getAll().every((s) => s.showInContextMenu)).toBe(true);
  });

  // NEW — replace with these:
  it('registers 6 shortcuts', () => {
    const svc = new KeyboardService();
    renderHook(() => useCellShortcuts(svc), { wrapper: makeWrapper(svc) });
    expect(svc.getAll()).toHaveLength(6);
  });

  it('cell.viewRecord has showInContextMenu: true', () => {
    const svc = new KeyboardService();
    renderHook(() => useCellShortcuts(svc), { wrapper: makeWrapper(svc) });
    const s = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    expect(s.showInContextMenu).toBe(true);
  });

  it('cell.editRecord has showInContextMenu: false', () => {
    const svc = new KeyboardService();
    renderHook(() => useCellShortcuts(svc), { wrapper: makeWrapper(svc) });
    const s = svc.getAll().find((s) => s.id === 'cell.editRecord')!;
    expect(s.showInContextMenu).toBe(false);
  });
  ```

  Then append these tests to the `describe('useCellShortcuts', ...)` block:

  ```ts
  it('F3 calls onViewRecord with selected doc', () => {
    const svc = new KeyboardService();
    const onViewRecord = vi.fn();
    const doc = { name: 'alice' };
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc, { onViewRecord }), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const viewShortcut = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    act(() => { viewShortcut.action(); });
    expect(onViewRecord).toHaveBeenCalledWith(doc);
  });

  it('F4 calls onEditRecord with selected doc', () => {
    const svc = new KeyboardService();
    const onEditRecord = vi.fn();
    const doc = { name: 'alice' };
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc, { onEditRecord }), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const editShortcut = svc.getAll().find((s) => s.id === 'cell.editRecord')!;
    act(() => { editShortcut.action(); });
    expect(onEditRecord).toHaveBeenCalledWith(doc);
  });

  it('F3 does nothing when no cell is selected', () => {
    const svc = new KeyboardService();
    const onViewRecord = vi.fn();
    renderHook(() => useCellShortcuts(svc, { onViewRecord }), { wrapper: makeWrapper(svc) });
    const viewShortcut = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    act(() => { viewShortcut.action(); });
    expect(onViewRecord).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 1.2: Run tests to confirm they fail**

  ```bash
  npx vitest run src/__tests__/cell-selection-context.test.tsx
  ```

  Expected: FAIL — `registers 6 shortcuts` fails with length 4, F3/F4 tests fail with "undefined is not a function".

- [ ] **Step 1.3: Implement the changes in `useCellShortcuts.ts`**

  Replace the entire file content:

  ```ts
  import { useCellSelection } from '../contexts/CellSelectionContext';
  import { useKeyboard } from './useKeyboard';
  import { keyboardService, type KeyboardService } from '../services/KeyboardService';

  interface CellShortcutsOptions {
    onViewRecord?: (doc: Record<string, unknown>) => void;
    onEditRecord?: (doc: Record<string, unknown>) => void;
  }

  export function useCellShortcuts(
    svc: KeyboardService = keyboardService,
    options?: CellShortcutsOptions,
  ): void {
    const { selected } = useCellSelection();

    useKeyboard({
      id: 'cell.copyValue',
      keys: { cmd: true, key: 'c' },
      label: 'Copy Value',
      showInContextMenu: true,
      action: () => {
        if (!selected) return;
        navigator.clipboard.writeText(String(selected.value));
      },
    }, svc);

    useKeyboard({
      id: 'cell.copyField',
      keys: { ctrl: true, cmd: true, key: 'c' },
      label: 'Copy Field',
      showInContextMenu: true,
      action: () => {
        if (!selected) return;
        navigator.clipboard.writeText(`"${selected.colKey}": ${JSON.stringify(selected.value)}`);
      },
    }, svc);

    useKeyboard({
      id: 'cell.copyFieldPath',
      keys: { shift: true, alt: true, cmd: true, key: 'c' },
      label: 'Copy Field Path',
      showInContextMenu: true,
      action: () => {
        if (!selected) return;
        navigator.clipboard.writeText(selected.colKey);
      },
    }, svc);

    useKeyboard({
      id: 'cell.copyDocument',
      keys: { shift: true, cmd: true, key: 'c' },
      label: 'Copy Document',
      showInContextMenu: true,
      action: () => {
        if (!selected) return;
        navigator.clipboard.writeText(JSON.stringify(selected.doc, null, 2));
      },
    }, svc);

    useKeyboard({
      id: 'cell.viewRecord',
      keys: { key: 'F3' },
      label: 'View Full Record',
      showInContextMenu: true,
      action: () => {
        if (!selected) return;
        options?.onViewRecord?.(selected.doc);
      },
    }, svc);

    useKeyboard({
      id: 'cell.editRecord',
      keys: { key: 'F4' },
      label: 'Edit Full Record',
      showInContextMenu: false,
      action: () => {
        if (!selected) return;
        options?.onEditRecord?.(selected.doc);
      },
    }, svc);
  }
  ```

- [ ] **Step 1.4: Run tests to confirm they pass**

  ```bash
  npx vitest run src/__tests__/cell-selection-context.test.tsx
  ```

  Expected: all tests PASS.

- [ ] **Step 1.5: Commit**

  ```bash
  git add src/hooks/useCellShortcuts.ts src/__tests__/cell-selection-context.test.tsx
  git commit -m "feat(shortcuts): add F3/F4 view-record and edit-record shortcuts"
  ```

---

## Task 2: Create `RecordModal` Component

**Files:**
- Create: `src/components/results/RecordModal.tsx`
- Create: `src/__tests__/record-modal.test.tsx`

- [ ] **Step 2.1: Write the failing tests**

  Create `src/__tests__/record-modal.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, act } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { RecordModal } from '../components/results/RecordModal';

  vi.mock('../ipc', () => ({
    updateDocument: vi.fn().mockResolvedValue(undefined),
  }));

  import { updateDocument } from '../ipc';

  const BASE_PROPS = {
    doc: { _id: 'abc123', name: 'Alice', age: 30 },
    connectionId: 'conn1',
    database: 'mydb',
    collection: 'users',
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RecordModal — view mode', () => {
    it('shows Full Record header', () => {
      render(<RecordModal {...BASE_PROPS} initialMode="view" />);
      expect(screen.getByText('Full Record')).toBeInTheDocument();
    });

    it('shows _id value in the badge', () => {
      render(<RecordModal {...BASE_PROPS} initialMode="view" />);
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });

    it('shows JSON without _id and with commas', () => {
      render(<RecordModal {...BASE_PROPS} initialMode="view" />);
      const pre = screen.getByRole('dialog').querySelector('pre')!;
      const parsed = JSON.parse(pre.textContent!);
      expect(parsed).toEqual({ name: 'Alice', age: 30 });
      expect(parsed).not.toHaveProperty('_id');
      expect(pre.textContent).toContain(',');
    });

    it('Edit button switches to edit mode', async () => {
      const user = userEvent.setup();
      render(<RecordModal {...BASE_PROPS} initialMode="view" />);
      await user.click(screen.getByText('Edit (F4)'));
      expect(screen.getByText('Edit Record')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('Close button calls onClose', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<RecordModal {...BASE_PROPS} initialMode="view" onClose={onClose} />);
      await user.click(screen.getByText('Close'));
      expect(onClose).toHaveBeenCalled();
    });

    it('Esc key calls onClose', async () => {
      const onClose = vi.fn();
      render(<RecordModal {...BASE_PROPS} initialMode="view" onClose={onClose} />);
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('RecordModal — edit mode', () => {
    it('shows Edit Record header', () => {
      render(<RecordModal {...BASE_PROPS} initialMode="edit" />);
      expect(screen.getByText('Edit Record')).toBeInTheDocument();
    });

    it('textarea pre-populated with JSON excluding _id', () => {
      render(<RecordModal {...BASE_PROPS} initialMode="edit" />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      const parsed = JSON.parse(ta.value);
      expect(parsed).toEqual({ name: 'Alice', age: 30 });
      expect(parsed).not.toHaveProperty('_id');
    });

    it('Submit with no changes closes without calling updateDocument', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<RecordModal {...BASE_PROPS} initialMode="edit" onClose={onClose} />);
      await user.click(screen.getByText('Submit'));
      expect(updateDocument).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('Submit with changes calls updateDocument and onSaved', async () => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RecordModal {...BASE_PROPS} initialMode="edit" onSaved={onSaved} onClose={onClose} />);
      const ta = screen.getByRole('textbox');
      await user.clear(ta);
      await user.type(ta, '{"name":"Bob","age":31}');
      await user.click(screen.getByText('Submit'));
      expect(updateDocument).toHaveBeenCalledWith(
        'conn1', 'mydb', 'users', 'abc123',
        JSON.stringify({ name: 'Bob', age: 31 }),
      );
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('Submit with invalid JSON shows error and does not call updateDocument', async () => {
      const user = userEvent.setup();
      render(<RecordModal {...BASE_PROPS} initialMode="edit" />);
      const ta = screen.getByRole('textbox');
      await user.clear(ta);
      await user.type(ta, '{bad json');
      await user.click(screen.getByText('Submit'));
      expect(updateDocument).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog').textContent).toMatch(/JSON|Expected|Unexpected|token/i);
    });

    it('Cancel from F4 (initialMode=edit) calls onClose', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<RecordModal {...BASE_PROPS} initialMode="edit" onClose={onClose} />);
      await user.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });

    it('Cancel from Edit button (initialMode=view) returns to view mode', async () => {
      const user = userEvent.setup();
      render(<RecordModal {...BASE_PROPS} initialMode="view" />);
      await user.click(screen.getByText('Edit (F4)'));
      expect(screen.getByText('Edit Record')).toBeInTheDocument();
      await user.click(screen.getByText('Cancel'));
      expect(screen.getByText('Full Record')).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2.2: Run tests to confirm they fail**

  ```bash
  npx vitest run src/__tests__/record-modal.test.tsx
  ```

  Expected: FAIL — "Cannot find module '../components/results/RecordModal'".

- [ ] **Step 2.3: Implement `RecordModal.tsx`**

  Create `src/components/results/RecordModal.tsx`:

  ```tsx
  import { useState, useEffect } from 'react';
  import { updateDocument } from '../../ipc';

  interface RecordModalProps {
    doc: Record<string, unknown>;
    initialMode: 'view' | 'edit';
    connectionId: string;
    database: string;
    collection: string;
    onClose: () => void;
    onSaved: () => void;
  }

  export function RecordModal({
    doc,
    initialMode,
    connectionId,
    database,
    collection,
    onClose,
    onSaved,
  }: RecordModalProps) {
    const { _id, ...rest } = doc;
    const idStr = String(_id ?? '');
    const originalJson = JSON.stringify(rest, null, 2);

    const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
    const [editedJson, setEditedJson] = useState(originalJson);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
      }
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    async function handleSubmit() {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(editedJson);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      if (JSON.stringify(parsed) === JSON.stringify(rest)) {
        onClose();
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await updateDocument(connectionId, database, collection, idStr, JSON.stringify(parsed));
        onSaved();
        onClose();
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    }

    function handleCancel() {
      if (initialMode === 'edit') {
        onClose();
      } else {
        setMode('view');
        setEditedJson(originalJson);
        setError(null);
      }
    }

    function switchToEdit() {
      setEditedJson(originalJson);
      setMode('edit');
    }

    return (
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={mode === 'view' ? 'Full Record' : 'Edit Record'}
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            width: 600,
            maxWidth: '90vw',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            padding: 16,
            gap: 12,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontWeight: 600,
                color: mode === 'edit' ? 'var(--accent-orange, #ed8936)' : 'var(--fg)',
              }}
            >
              {mode === 'view' ? 'Full Record' : 'Edit Record'}
            </span>
            <button aria-label="Close" onClick={onClose}>✕</button>
          </div>

          {/* _id read-only badge */}
          <div
            style={{
              background: 'var(--bg-row-alt, #2d3748)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 10px',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--fg-dim)', textTransform: 'uppercase', fontSize: 10, letterSpacing: 1 }}>_id</span>
            <span style={{ color: 'var(--accent-yellow, #fbd38d)' }}>{idStr}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--fg-dim)', fontSize: 10 }}>read-only</span>
          </div>

          {/* JSON view or edit */}
          {mode === 'view' ? (
            <pre
              style={{
                flex: 1, overflow: 'auto', margin: 0,
                background: 'var(--bg-code, #0d1117)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 10,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--fg)',
                minHeight: 200,
              }}
            >
              {originalJson}
            </pre>
          ) : (
            <textarea
              style={{
                flex: 1, resize: 'none',
                background: 'var(--bg-code, #0d1117)',
                border: `1px solid ${error ? 'var(--accent-red, #fc8181)' : 'var(--accent-blue, #63b3ed)'}`,
                borderRadius: 4,
                padding: 10,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--fg)',
                minHeight: 200,
              }}
              value={editedJson}
              onChange={(e) => { setEditedJson(e.target.value); setError(null); }}
              spellCheck={false}
            />
          )}

          {/* Error banner */}
          {error && (
            <div
              style={{
                background: 'var(--accent-red-dim, #742a2a)',
                border: '1px solid var(--accent-red, #fc8181)',
                borderRadius: 4,
                padding: '4px 8px',
                color: 'var(--accent-red, #fc8181)',
                fontSize: 12,
              }}
            >
              ✕ {error}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            {mode === 'view' ? (
              <>
                <button onClick={onClose}>Close</button>
                <button onClick={switchToEdit}>Edit (F4)</button>
              </>
            ) : (
              <>
                <span style={{ marginRight: 'auto', color: 'var(--fg-dim)', fontSize: 11 }}>
                  No changes → submit is a no-op
                </span>
                <button onClick={handleCancel} disabled={saving}>Cancel</button>
                <button onClick={handleSubmit} disabled={saving}>
                  {saving ? 'Saving…' : 'Submit'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2.4: Run tests to confirm they pass**

  ```bash
  npx vitest run src/__tests__/record-modal.test.tsx
  ```

  Expected: all tests PASS.

- [ ] **Step 2.5: Commit**

  ```bash
  git add src/components/results/RecordModal.tsx src/__tests__/record-modal.test.tsx
  git commit -m "feat(modal): add RecordModal component for view and edit modes"
  ```

---

## Task 3: Wire `ResultsPanel` to `RecordModal`

**Files:**
- Modify: `src/components/results/ResultsPanel.tsx`
- Modify: `src/__tests__/results-panel.test.tsx`

- [ ] **Step 3.1: Add failing integration tests**

  Append this describe block to `src/__tests__/results-panel.test.tsx`:

  ```ts
  describe('ResultsPanel record modal', () => {
    beforeEach(() => {
      useResultsStore.setState({
        byTab: {
          t1: {
            groups: [{ groupIndex: 0, docs: [{ _id: 'abc123', city: 'Tokyo' }] }],
            isRunning: false,
            executionMs: 5,
          },
        },
      });
    });

    it('F3 opens view modal when a cell is selected', async () => {
      const user = userEvent.setup();
      render(
        <ResultsPanel
          tabId="t1"
          pageSize={50}
          connectionId="conn1"
          database="mydb"
          collection="users"
        />
      );
      await user.click(screen.getByText('Table'));
      const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
      await user.click(cell);
      await user.keyboard('{F3}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Full Record')).toBeInTheDocument();
    });

    it('F4 opens edit modal when a cell is selected', async () => {
      const user = userEvent.setup();
      render(
        <ResultsPanel
          tabId="t1"
          pageSize={50}
          connectionId="conn1"
          database="mydb"
          collection="users"
        />
      );
      await user.click(screen.getByText('Table'));
      const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
      await user.click(cell);
      await user.keyboard('{F4}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Edit Record')).toBeInTheDocument();
    });

    it('Esc closes the modal', async () => {
      const user = userEvent.setup();
      render(
        <ResultsPanel
          tabId="t1"
          pageSize={50}
          connectionId="conn1"
          database="mydb"
          collection="users"
        />
      );
      await user.click(screen.getByText('Table'));
      const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
      await user.click(cell);
      await user.keyboard('{F3}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not open modal when connectionId is absent', async () => {
      const user = userEvent.setup();
      render(<ResultsPanel tabId="t1" pageSize={50} />);
      await user.click(screen.getByText('Table'));
      const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
      await user.click(cell);
      await user.keyboard('{F3}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 3.2: Run tests to confirm they fail**

  ```bash
  npx vitest run src/__tests__/results-panel.test.tsx
  ```

  Expected: FAIL — new modal tests fail because ResultsPanel doesn't yet accept or use the new props.

- [ ] **Step 3.3: Update `ResultsPanel.tsx`**

  Apply these changes to `src/components/results/ResultsPanel.tsx`:

  **a) Add import at the top:**
  ```ts
  import { useState } from 'react';  // already imported — just add RecordModal
  import { RecordModal } from './RecordModal';
  import { keyboardService } from '../../services/KeyboardService';
  ```

  **b) Replace `CellShortcutsRegistrar`:**
  ```tsx
  // OLD:
  function CellShortcutsRegistrar() {
    useCellShortcuts();
    return null;
  }

  // NEW:
  function CellShortcutsRegistrar({
    onViewRecord,
    onEditRecord,
  }: {
    onViewRecord?: (doc: Record<string, unknown>) => void;
    onEditRecord?: (doc: Record<string, unknown>) => void;
  }) {
    useCellShortcuts(keyboardService, { onViewRecord, onEditRecord });
    return null;
  }
  ```

  **c) Extend `Props` interface:**
  ```ts
  interface Props {
    tabId: string;
    pageSize: number;
    onPageChange?: (page: number, pageSize: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
    connectionId?: string;
    database?: string;
    collection?: string;
    onDocUpdated?: () => void;
  }
  ```

  **d) Destructure new props in function signature:**
  ```ts
  export function ResultsPanel({
    tabId, pageSize, onPageChange, onPageSizeChange,
    connectionId, database, collection, onDocUpdated,
  }: Props) {
  ```

  **e) Add modal state inside the function body, after existing `useState` calls:**
  ```ts
  const [recordModal, setRecordModal] = useState<{
    doc: Record<string, unknown>;
    mode: 'view' | 'edit';
  } | null>(null);
  ```

  **f) Replace the `<CellShortcutsRegistrar />` usage:**
  ```tsx
  // OLD:
  <CellShortcutsRegistrar />

  // NEW:
  <CellShortcutsRegistrar
    onViewRecord={connectionId && database && collection
      ? (doc) => setRecordModal({ doc, mode: 'view' })
      : undefined}
    onEditRecord={connectionId && database && collection
      ? (doc) => setRecordModal({ doc, mode: 'edit' })
      : undefined}
  />
  ```

  **g) Add `RecordModal` render just before the closing `</CellSelectionProvider>` tag:**
  ```tsx
  {recordModal && connectionId && database && collection && (
    <RecordModal
      doc={recordModal.doc}
      initialMode={recordModal.mode}
      connectionId={connectionId}
      database={database}
      collection={collection}
      onClose={() => setRecordModal(null)}
      onSaved={() => { setRecordModal(null); onDocUpdated?.(); }}
    />
  )}
  ```

  Note: add this inside **both** `return` statements (the early "Run a script" return and the main return), both are wrapped in `<CellSelectionProvider>`.

- [ ] **Step 3.4: Run tests to confirm they pass**

  ```bash
  npx vitest run src/__tests__/results-panel.test.tsx
  ```

  Expected: all tests PASS.

- [ ] **Step 3.5: Run full test suite**

  ```bash
  npx vitest run
  ```

  Expected: all tests PASS.

- [ ] **Step 3.6: Commit**

  ```bash
  git add src/components/results/ResultsPanel.tsx src/__tests__/results-panel.test.tsx
  git commit -m "feat(results): wire RecordModal into ResultsPanel with F3/F4 keyboard support"
  ```

---

## Task 4: Wire `ResultsPanel` in `BrowseTab`

**Files:**
- Modify: `src/components/editor/BrowseTab.tsx`

- [ ] **Step 4.1: Pass connection props to `ResultsPanel`**

  Open `src/components/editor/BrowseTab.tsx`. Find where `<ResultsPanel>` is rendered and add the three new props:

  ```tsx
  // Before (example — match whatever is in BrowseTab):
  <ResultsPanel
    tabId={tabId}
    pageSize={pageSize}
    onPageChange={handlePageChange}
    onPageSizeChange={handlePageSizeChange}
  />

  // After:
  <ResultsPanel
    tabId={tabId}
    pageSize={pageSize}
    onPageChange={handlePageChange}
    onPageSizeChange={handlePageSizeChange}
    connectionId={connectionId}
    database={database}
    collection={collection}
    onDocUpdated={load}
  />
  ```

  `connectionId`, `database`, `collection`, and `load` are already available in `BrowseTab` (used by the existing `handleEditCell` and `handleDeleteRow` logic).

- [ ] **Step 4.2: Run full test suite**

  ```bash
  npx vitest run
  ```

  Expected: all tests PASS.

- [ ] **Step 4.3: Commit**

  ```bash
  git add src/components/editor/BrowseTab.tsx
  git commit -m "feat(browse): pass connection context to ResultsPanel for record modal"
  ```

---

## Self-Review Checklist

- [x] F3 opens view modal — covered Task 1 + Task 3
- [x] F4 opens edit modal — covered Task 1 + Task 3
- [x] Right-click "View Full Record" — automatic via `showInContextMenu: true` on `cell.viewRecord`, no extra code needed
- [x] `_id` read-only badge, not in editable JSON — Task 2
- [x] Commas visible in view mode — `JSON.stringify(rest, null, 2)` always includes commas
- [x] Dirty check — no API call if unchanged — Task 2 test "Submit with no changes"
- [x] JSON validation error banner — Task 2 test "Submit with invalid JSON"
- [x] Cancel from F4 → close; Cancel from Edit button → back to view — Task 2
- [x] Esc closes modal — Task 2 + Task 3
- [x] `onDocUpdated` triggers data refresh — Task 3 + Task 4 (`load` callback)
- [x] No modal when no connection context — Task 3 test "does not open modal when connectionId is absent"
