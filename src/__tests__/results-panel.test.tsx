import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsPanel } from '../components/results/ResultsPanel';
import { useResultsStore } from '../store/results';
import { keyboardService } from '../services/KeyboardService';

let removeKeydownListener: (() => void) | null = null;

beforeEach(() => {
  useResultsStore.setState({ byTab: {} });
  // Mirror App.tsx global dispatch so keyboard shortcuts fire in tests.
  const handler = (e: KeyboardEvent) => keyboardService.dispatch(e);
  window.addEventListener('keydown', handler);
  removeKeydownListener = () => window.removeEventListener('keydown', handler);
});

afterEach(() => {
  removeKeydownListener?.();
  removeKeydownListener = null;
});

describe('ResultsPanel', () => {
  it('shows placeholder when no results for tab', () => {
    render(<ResultsPanel tabId="t1" pageSize={50} />);
    expect(screen.getByText(/Run a script/i)).toBeInTheDocument();
  });

  it('renders JSON by default', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ name: 'alice' }] }],
          isRunning: false,
          executionMs: 10,
        },
      },
    });
    render(<ResultsPanel tabId="t1" pageSize={50} />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it('switches to Table view', async () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ name: 'alice' }, { name: 'bob' }] }],
          isRunning: false,
          executionMs: 10,
        },
      },
    });
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} />);
    await user.click(screen.getByText('Table'));
    expect(screen.getAllByRole('cell').some((c) => c.textContent === 'alice')).toBe(true);
  });
});

describe('ResultsPanel pagination', () => {
  it('shows no pagination controls when pagination is absent', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ id: 1 }] }],
          isRunning: false,
          executionMs: 5,
        },
      },
    });
    render(<ResultsPanel tabId="t1" pageSize={50} onPageChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /prev/i })).not.toBeInTheDocument();
  });

  it('shows pagination controls when pagination is set', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ id: 1 }] }],
          isRunning: false,
          executionMs: 5,
          pagination: { total: 200, page: 1, pageSize: 50 },
        },
      },
    });
    render(<ResultsPanel tabId="t1" pageSize={50} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(screen.getByText(/of 4/i)).toBeInTheDocument();
  });

  it('calls onPageChange with prev page when Prev clicked', async () => {
    const onPageChange = vi.fn();
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [],
          isRunning: false,
          pagination: { total: 200, page: 2, pageSize: 50 },
        },
      },
    });
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} onPageChange={onPageChange} />);
    await user.click(screen.getByRole('button', { name: /prev/i }));
    expect(onPageChange).toHaveBeenCalledWith(1, 50);
  });

  it('disables Prev on page 0', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [],
          isRunning: false,
          pagination: { total: 100, page: 0, pageSize: 50 },
        },
      },
    });
    render(<ResultsPanel tabId="t1" pageSize={50} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
  });

  it('disables Next on last page', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [],
          isRunning: false,
          pagination: { total: 100, page: 1, pageSize: 50 },
        },
      },
    });
    render(<ResultsPanel tabId="t1" pageSize={50} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('shows "of 1" and disables Next for empty collection (total=0)', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [],
          isRunning: false,
          pagination: { total: 0, page: 0, pageSize: 50 },
        },
      },
    });
    render(<ResultsPanel tabId="t1" pageSize={50} onPageChange={() => {}} />);
    expect(screen.getByText(/of 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});

describe('ResultsPanel cell shortcuts integration', () => {
  beforeEach(() => {
    useResultsStore.setState({ byTab: {} });
  });

  it('clicking a table cell and pressing Cmd+C copies the value', async () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ city: 'Tokyo' }] }],
          isRunning: false,
          executionMs: 5,
        },
      },
    });
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(<ResultsPanel tabId="t1" pageSize={50} />);
    await user.click(screen.getByText('Table'));
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
    await user.click(cell);
    await user.keyboard('{Meta>}c{/Meta}');
    expect(writeText).toHaveBeenCalledWith('Tokyo');
  });

  it('clears selection when tabId changes', async () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ city: 'Tokyo' }] }],
          isRunning: false,
          executionMs: 5,
        },
        t2: {
          groups: [{ groupIndex: 0, docs: [{ city: 'Paris' }] }],
          isRunning: false,
          executionMs: 5,
        },
      },
    });
    const user = userEvent.setup();
    const { rerender } = render(<ResultsPanel tabId="t1" pageSize={50} />);
    await user.click(screen.getByText('Table'));
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
    await user.click(cell);
    expect(cell.getAttribute('aria-selected')).toBe('true');

    // Switch to tab t2 — selection must clear
    rerender(<ResultsPanel tabId="t2" pageSize={50} />);
    // No cell should be selected in the new tab
    const cells = screen.getAllByRole('cell');
    expect(cells.every((c) => c.getAttribute('aria-selected') !== 'true')).toBe(true);
  });
});

describe('ResultsPanel record modal', () => {
  beforeEach(() => {
    // F4 availability now derives from per-group metadata (collection +
    // category) emitted by the runner, not from a tab prop. Seed a group
    // that looks like a successful `find()` on `users`.
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{
            groupIndex: 0,
            docs: [{ _id: 'abc123', city: 'Tokyo' }],
            collection: 'users',
            category: 'query',
          }],
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

  it('F3 opens view modal even without connectionId (view is always available)', async () => {
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} />);
    await user.click(screen.getByText('Table'));
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
    await user.click(cell);
    await user.keyboard('{F3}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Full Record')).toBeInTheDocument();
  });

  it('F4 does not open edit modal when collection is absent', async () => {
    // Override the beforeEach seed with a group whose classifier could not
    // resolve a target collection (e.g. `db[dynamic].find({})`). F4 must
    // remain disabled even though the doc is selected.
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{
            groupIndex: 0,
            docs: [{ _id: 'abc123', city: 'Tokyo' }],
            category: 'query',
          }],
          isRunning: false,
          executionMs: 5,
        },
      },
    });
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} connectionId="conn1" database="mydb" />);
    await user.click(screen.getByText('Table'));
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
    await user.click(cell);
    await user.keyboard('{F4}');
    expect(screen.queryByText('Edit Record')).not.toBeInTheDocument();
  });
});

describe('ResultsPanel F4 category gating', () => {
  // Table-driven: F4 must stay disabled for every non-`query` category even
  // when a collection is cleanly extracted. Spec §"Edit Availability Logic".
  const disabledCategories = ['mutation', 'transform', 'maintenance', 'stream'] as const;

  for (const category of disabledCategories) {
    it(`F4 does not open edit modal when category is '${category}'`, async () => {
      useResultsStore.setState({
        byTab: {
          t1: {
            groups: [{
              groupIndex: 0,
              docs: [{ _id: 'abc123', city: 'Tokyo' }],
              collection: 'targetColl',
              category,
            }],
            isRunning: false,
            executionMs: 5,
          },
        },
      });
      const user = userEvent.setup();
      render(<ResultsPanel tabId="t1" pageSize={50} connectionId="conn1" database="mydb" />);
      await user.click(screen.getByText('Table'));
      const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Tokyo')!;
      await user.click(cell);
      await user.keyboard('{F4}');
      expect(screen.queryByText('Edit Record')).not.toBeInTheDocument();
    });
  }
});

describe('ResultsPanel multi-group F4 targeting', () => {
  // Seed two groups: a query on `users` (F4 should work) and an aggregate on
  // `orders` (F4 should stay disabled). Switching group tabs must flip F4
  // availability without remounting the panel.
  beforeEach(() => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [
            {
              groupIndex: 0,
              docs: [{ _id: 'u1', name: 'Alice' }],
              collection: 'users',
              category: 'query',
            },
            {
              groupIndex: 1,
              docs: [{ _id: 'agg1', total: 42 }],
              collection: 'orders',
              category: 'transform',
            },
          ],
          isRunning: false,
          executionMs: 5,
        },
      },
    });
  });

  it('F4 is enabled on the `query` group tab (users)', async () => {
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} connectionId="conn1" database="mydb" />);
    await user.click(screen.getByText('Table'));
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === 'Alice')!;
    await user.click(cell);
    await user.keyboard('{F4}');
    expect(screen.getByText('Edit Record')).toBeInTheDocument();
  });

  it('switching to the `transform` group tab disables F4', async () => {
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} connectionId="conn1" database="mydb" />);
    await user.click(screen.getByText('Table'));
    // Jump to Query 2 (the aggregation on orders)
    await user.click(screen.getByRole('tab', { name: 'Query 2' }));
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === '42')!;
    await user.click(cell);
    await user.keyboard('{F4}');
    expect(screen.queryByText('Edit Record')).not.toBeInTheDocument();
  });

  it('F3 works on both groups regardless of category', async () => {
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" pageSize={50} connectionId="conn1" database="mydb" />);
    await user.click(screen.getByText('Table'));

    // Group 0: query on users — F3 works
    const aliceCell = screen.getAllByRole('cell').find((c) => c.textContent === 'Alice')!;
    await user.click(aliceCell);
    await user.keyboard('{F3}');
    expect(screen.getByText('Full Record')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    // Group 1: aggregate on orders — F3 still works (view is category-agnostic)
    await user.click(screen.getByRole('tab', { name: 'Query 2' }));
    const aggCell = screen.getAllByRole('cell').find((c) => c.textContent === '42')!;
    await user.click(aggCell);
    await user.keyboard('{F3}');
    expect(screen.getByText('Full Record')).toBeInTheDocument();
  });
});

describe('useScriptEvents → store forwarding', () => {
  // Integration coverage for the event-pipeline invariant: when the harness
  // emits a `group` event carrying collection + category, those fields land
  // in the ResultsStore entry via appendGroup (mirroring the `useScriptEvents`
  // payload-shape → appendGroup mapping). This is the same contract
  // ResultsPanel relies on downstream for F4 gating.
  it('appendGroup persists collection and category on the stored group', () => {
    const { startRun, appendGroup } = useResultsStore.getState();
    startRun('tForward', 'run-1');
    appendGroup('tForward', {
      groupIndex: 0,
      docs: [{ _id: '1' }],
      collection: 'users',
      category: 'query',
    });
    const stored = useResultsStore.getState().byTab['tForward'];
    expect(stored).toBeDefined();
    expect(stored!.groups[0].collection).toBe('users');
    expect(stored!.groups[0].category).toBe('query');
  });

  it('appendGroup preserves undefined collection/category when classifier returned null', () => {
    const { startRun, appendGroup } = useResultsStore.getState();
    startRun('tForward2', 'run-2');
    appendGroup('tForward2', {
      groupIndex: 0,
      docs: [{ _id: '2' }],
      // collection and category intentionally omitted (e.g. dynamic collection)
    });
    const stored = useResultsStore.getState().byTab['tForward2'];
    expect(stored).toBeDefined();
    expect(stored!.groups[0].collection).toBeUndefined();
    expect(stored!.groups[0].category).toBeUndefined();
  });
});
