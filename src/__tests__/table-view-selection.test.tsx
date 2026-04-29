import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TableView } from '../components/results/TableView';
import { CellSelectionProvider } from '../contexts/CellSelectionContext';
import { useRecordActions } from '../hooks/useRecordActions';
import { keyboardService } from '../services/KeyboardService';
import type { RecordContext } from '../services/records/RecordContext';
import type { RecordActionHost } from '../services/records/RecordActionHost';
import type { ResultGroup } from '../types';

const noopHost: RecordActionHost = {
  openModal: vi.fn(),
  close: vi.fn(),
  triggerDocUpdate: vi.fn(),
  executeAction: vi.fn(),
};

const baseContext: RecordContext = { doc: {} as Record<string, unknown> };

function ShortcutsRegistrar({
  host = noopHost,
  context = baseContext,
  groups,
}: {
  host?: RecordActionHost;
  context?: RecordContext;
  groups?: ResultGroup[];
} = {}) {
  // Mirror ResultsPanel: keep a ref to the groups array so record actions can
  // look up per-group collection/category.
  const groupsRef = useRef<ResultGroup[]>(groups ?? []);
  groupsRef.current = groups ?? [];
  useRecordActions(context, host, undefined, undefined, undefined, groupsRef);
  return null;
}

const docs = [{ name: 'alice', age: 30 }, { name: 'bob', age: 25 }];

let removeKeydownListener: (() => void) | null = null;

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
  // Mirror what App.tsx does — dispatch keydown events through keyboardService.
  const handler = (e: KeyboardEvent) => keyboardService.dispatch(e);
  window.addEventListener('keydown', handler);
  removeKeydownListener = () => window.removeEventListener('keydown', handler);
});

afterEach(() => {
  removeKeydownListener?.();
  removeKeydownListener = null;
});

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <CellSelectionProvider>
      {/* scope zone mirrors KeyboardScopeZone used in ResultsPanel */}
      <div data-keyboard-scope="results">
        <ShortcutsRegistrar />
        {children}
      </div>
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

  it('F3 on selected cell invokes host.openModal with Full Record', async () => {
    const user = userEvent.setup();
    const host: RecordActionHost = {
      openModal: vi.fn(),
      close: vi.fn(),
      triggerDocUpdate: vi.fn(),
      executeAction: vi.fn(),
    };

    function WrapperWithHost({ children }: { children: ReactNode }) {
      return (
        <CellSelectionProvider>
          <div data-keyboard-scope="results">
            <ShortcutsRegistrar host={host} />
            {children}
          </div>
        </CellSelectionProvider>
      );
    }

    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: WrapperWithHost });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    await user.keyboard('{F3}');
    expect(host.openModal).toHaveBeenCalledWith('Full Record', expect.anything(), expect.anything());
  });

  it('F4 on selected cell with group collection/category invokes host.openModal with Edit Record', async () => {
    const user = userEvent.setup();
    const host: RecordActionHost = {
      openModal: vi.fn(),
      close: vi.fn(),
      triggerDocUpdate: vi.fn(),
      executeAction: vi.fn(),
    };
    // F4 availability now derives from per-group metadata, not a static ctx
    // prop — mirror the runtime model in the test.
    const groups: ResultGroup[] = [
      { groupIndex: 0, docs, collection: 'users', category: 'query' },
    ];

    function WrapperWithHost({ children }: { children: ReactNode }) {
      return (
        <CellSelectionProvider>
          <div data-keyboard-scope="results">
            <ShortcutsRegistrar host={host} groups={groups} />
            {children}
          </div>
        </CellSelectionProvider>
      );
    }

    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: WrapperWithHost });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    await user.keyboard('{F4}');
    expect(host.openModal).toHaveBeenCalledWith('Edit Record', expect.anything(), null, expect.anything());
  });

  it('F4 stays disabled when the group category is not `query` (e.g. aggregate)', async () => {
    const user = userEvent.setup();
    const host: RecordActionHost = {
      openModal: vi.fn(),
      close: vi.fn(),
      triggerDocUpdate: vi.fn(),
      executeAction: vi.fn(),
    };
    const groups: ResultGroup[] = [
      { groupIndex: 0, docs, collection: 'orders', category: 'transform' },
    ];

    function WrapperWithHost({ children }: { children: ReactNode }) {
      return (
        <CellSelectionProvider>
          <div data-keyboard-scope="results">
            <ShortcutsRegistrar host={host} groups={groups} />
            {children}
          </div>
        </CellSelectionProvider>
      );
    }

    render(<TableView docs={docs} sortKey={null} sortDir={1} onToggleSort={() => {}} />, { wrapper: WrapperWithHost });
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'alice')!;
    await user.click(cell);
    await user.keyboard('{F4}');
    expect(host.openModal).not.toHaveBeenCalled();
  });
});
