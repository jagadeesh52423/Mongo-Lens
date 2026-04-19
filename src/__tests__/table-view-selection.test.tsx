import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TableView } from '../components/results/TableView';
import { CellSelectionProvider } from '../contexts/CellSelectionContext';
import { useTableActions } from '../hooks/useTableActions';

function ShortcutsRegistrar({
  onViewRecord,
  onEditRecord,
}: {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
} = {}) {
  useTableActions({ onViewRecord, onEditRecord });
  return null;
}

const docs = [{ name: 'alice', age: 30 }, { name: 'bob', age: 25 }];

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <CellSelectionProvider>
      <ShortcutsRegistrar />
      {children}
    </CellSelectionProvider>
  );
}

describe('TableView cell selection', () => {
  it('clicking a cell gives it a selected style', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    expect(cell.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking a different cell deselects the previous one', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: Wrapper });
    const cells = screen.getAllByRole('cell');
    const alice = cells.find((c) => c.textContent === 'alice')!;
    const bob = cells.find((c) => c.textContent === 'bob')!;
    await user.click(alice);
    await user.click(bob);
    expect(alice.getAttribute('aria-selected')).toBe('false');
    expect(bob.getAttribute('aria-selected')).toBe('true');
  });

  it('right-clicking a cell opens context menu', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('context menu shows copy actions', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByText('Copy Value')).toBeInTheDocument();
    expect(screen.getByText('Copy Field')).toBeInTheDocument();
    expect(screen.getByText('Copy Field Path')).toBeInTheDocument();
    expect(screen.getByText('Copy Document')).toBeInTheDocument();
  });

  it('context menu shows View Full Record action', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByText('View Full Record')).toBeInTheDocument();
  });

  it('context menu shows Edit Full Record action', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByText('Edit Full Record')).toBeInTheDocument();
  });

  it('context menu closes on Escape', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('F3 on selected cell calls onViewRecord', async () => {
    const user = userEvent.setup();
    const onViewRecord = vi.fn();

    function WrapperWithHandlers({ children }: { children: ReactNode }) {
      return (
        <CellSelectionProvider>
          <ShortcutsRegistrar onViewRecord={onViewRecord} />
          {children}
        </CellSelectionProvider>
      );
    }

    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: WrapperWithHandlers });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    await user.keyboard('{F3}');
    expect(onViewRecord).toHaveBeenCalledWith({ name: 'alice', age: 30 });
  });

  it('F4 on selected cell calls onEditRecord', async () => {
    const user = userEvent.setup();
    const onEditRecord = vi.fn();

    function WrapperWithHandlers({ children }: { children: ReactNode }) {
      return (
        <CellSelectionProvider>
          <ShortcutsRegistrar onEditRecord={onEditRecord} />
          {children}
        </CellSelectionProvider>
      );
    }

    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: WrapperWithHandlers });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    await user.keyboard('{F4}');
    expect(onEditRecord).toHaveBeenCalledWith({ name: 'alice', age: 30 });
  });
});
