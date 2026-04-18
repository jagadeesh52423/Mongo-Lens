import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TableView } from '../components/results/TableView';
import { CellSelectionProvider } from '../contexts/CellSelectionContext';
import { useCellShortcuts } from '../hooks/useCellShortcuts';

function ShortcutsRegistrar() {
  useCellShortcuts();
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
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    expect(cell.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking a different cell deselects the previous one', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
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
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('context menu shows copy actions', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByText('Copy Value')).toBeInTheDocument();
    expect(screen.getByText('Copy Field')).toBeInTheDocument();
    expect(screen.getByText('Copy Field Path')).toBeInTheDocument();
    expect(screen.getByText('Copy Document')).toBeInTheDocument();
  });

  it('context menu closes on Escape', async () => {
    const user = userEvent.setup();
    render(<TableView docs={docs} />, { wrapper: Wrapper });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.pointer({ target: cell, keys: '[MouseRight]' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
