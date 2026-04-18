import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { CellSelectionProvider, useCellSelection } from '../contexts/CellSelectionContext';
import { useCellShortcuts } from '../hooks/useCellShortcuts';
import { useTableActions } from '../hooks/useTableActions';
import { KeyboardService, KeyboardServiceContext } from '../services/KeyboardService';

function TestConsumer() {
  const { selected, select, clear } = useCellSelection();
  return (
    <div>
      <span data-testid="col">{selected?.colKey ?? 'none'}</span>
      <span data-testid="value">{selected ? String(selected.value) : 'none'}</span>
      <button onClick={() => select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' })}>
        Select
      </button>
      <button onClick={clear}>Clear</button>
    </div>
  );
}

describe('CellSelectionContext', () => {
  it('starts with no selection', () => {
    render(<CellSelectionProvider><TestConsumer /></CellSelectionProvider>);
    expect(screen.getByTestId('col').textContent).toBe('none');
  });

  it('select() updates selected cell', async () => {
    const user = userEvent.setup();
    render(<CellSelectionProvider><TestConsumer /></CellSelectionProvider>);
    await user.click(screen.getByText('Select'));
    expect(screen.getByTestId('col').textContent).toBe('name');
    expect(screen.getByTestId('value').textContent).toBe('alice');
  });

  it('clear() resets selection', async () => {
    const user = userEvent.setup();
    render(<CellSelectionProvider><TestConsumer /></CellSelectionProvider>);
    await user.click(screen.getByText('Select'));
    await user.click(screen.getByText('Clear'));
    expect(screen.getByTestId('col').textContent).toBe('none');
  });
});

describe('useCellShortcuts', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  function makeWrapper(_svc: KeyboardService) {
    return ({ children }: { children: ReactNode }) => (
      <CellSelectionProvider>{children}</CellSelectionProvider>
    );
  }

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

  it('cmd+c copies value to clipboard', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyValue = svc.getAll().find((s) => s.id === 'cell.copyValue')!;
    await act(async () => { copyValue.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('alice');
  });

  it('ctrl+cmd+c copies field to clipboard', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyField = svc.getAll().find((s) => s.id === 'cell.copyField')!;
    await act(async () => { copyField.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('"name": "alice"');
  });

  it('shift+alt+cmd+c copies field path', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyPath = svc.getAll().find((s) => s.id === 'cell.copyFieldPath')!;
    await act(async () => { copyPath.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('name');
  });

  it('shift+cmd+c copies full document', async () => {
    const svc = new KeyboardService();
    const doc = { name: 'alice', age: 30 };
    const { result } = renderHook(
      () => ({ shortcuts: useCellShortcuts(svc), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const copyDoc = svc.getAll().find((s) => s.id === 'cell.copyDocument')!;
    await act(async () => { copyDoc.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(doc, null, 2));
  });

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
});

describe('useTableActions', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  function makeWrapper(svc: KeyboardService) {
    return ({ children }: { children: ReactNode }) => (
      <KeyboardServiceContext.Provider value={svc}>
        <CellSelectionProvider>{children}</CellSelectionProvider>
      </KeyboardServiceContext.Provider>
    );
  }

  it('registers 6 actions', () => {
    const svc = new KeyboardService();
    renderHook(() => useTableActions(), { wrapper: makeWrapper(svc) });
    expect(svc.getAll()).toHaveLength(6);
  });

  it('cell.viewRecord has showInContextMenu: true always', () => {
    const svc = new KeyboardService();
    renderHook(() => useTableActions(), { wrapper: makeWrapper(svc) });
    const s = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    expect(s.showInContextMenu).toBe(true);
  });

  it('cell.editRecord has showInContextMenu: true', () => {
    const svc = new KeyboardService();
    renderHook(() => useTableActions(), { wrapper: makeWrapper(svc) });
    const s = svc.getAll().find((s) => s.id === 'cell.editRecord')!;
    expect(s.showInContextMenu).toBe(true);
  });

  it('F3 calls onViewRecord with selected doc', () => {
    const svc = new KeyboardService();
    const onViewRecord = vi.fn();
    const doc = { name: 'alice' };
    const { result } = renderHook(
      () => ({ actions: useTableActions({ onViewRecord }), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const viewAction = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    act(() => { viewAction.action(); });
    expect(onViewRecord).toHaveBeenCalledWith(doc);
  });

  it('F4 calls onEditRecord with selected doc', () => {
    const svc = new KeyboardService();
    const onEditRecord = vi.fn();
    const doc = { name: 'alice' };
    const { result } = renderHook(
      () => ({ actions: useTableActions({ onEditRecord }), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc, value: 'alice' });
    });
    const editAction = svc.getAll().find((s) => s.id === 'cell.editRecord')!;
    act(() => { editAction.action(); });
    expect(onEditRecord).toHaveBeenCalledWith(doc);
  });

  it('F3 does nothing when no cell is selected', () => {
    const svc = new KeyboardService();
    const onViewRecord = vi.fn();
    renderHook(() => useTableActions({ onViewRecord }), { wrapper: makeWrapper(svc) });
    const viewAction = svc.getAll().find((s) => s.id === 'cell.viewRecord')!;
    act(() => { viewAction.action(); });
    expect(onViewRecord).not.toHaveBeenCalled();
  });

  it('cmd+c copies value to clipboard', async () => {
    const svc = new KeyboardService();
    const { result } = renderHook(
      () => ({ actions: useTableActions(), selection: useCellSelection() }),
      { wrapper: makeWrapper(svc) }
    );
    act(() => {
      result.current.selection.select({ rowIndex: 0, colKey: 'name', doc: { name: 'alice' }, value: 'alice' });
    });
    const copyValue = svc.getAll().find((s) => s.id === 'cell.copyValue')!;
    await act(async () => { copyValue.action(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('alice');
  });
});
