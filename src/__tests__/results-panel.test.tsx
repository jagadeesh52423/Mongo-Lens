import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsPanel } from '../components/results/ResultsPanel';
import { useResultsStore } from '../store/results';

beforeEach(() => {
  useResultsStore.setState({ byTab: {} });
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
});
