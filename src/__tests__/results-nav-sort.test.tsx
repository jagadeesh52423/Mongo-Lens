import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsPanel } from '../components/features/results/ResultsPanel';
import { useResultsStore } from '../store/results';
import { keyboardService } from '../services/KeyboardService';
import { recordActionRegistry } from '../services/records/RecordActionRegistry';

/**
 * Regression guard for the ViewModeRegistry navigation contract: when the
 * Table view is sorted, record-action ↑/↓ must move through the user-visible
 * display order, not the underlying insertion order. The active view publishes
 * its rendered docs/columns to ResultsPanel via `onRenderedDocsChange`; if
 * that wiring breaks, navigation will silently fall back to insertion order
 * and this test will fail.
 */

let removeKeydownListener: (() => void) | null = null;

beforeEach(() => {
  useResultsStore.setState({ byTab: {} });
  const handler = (e: KeyboardEvent) => keyboardService.dispatch(e);
  window.addEventListener('keydown', handler);
  removeKeydownListener = () => window.removeEventListener('keydown', handler);
  // jsdom doesn't implement scrollIntoView; record-action nav calls it.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () { /* noop */ };
  }
});

afterEach(() => {
  removeKeydownListener?.();
  removeKeydownListener = null;
});

describe('ResultsPanel sorted-table navigation', () => {
  it('ArrowDown after sorting selects the doc in display-order row 1, not insertion-order row 1', async () => {
    // Insertion order [b, a, c] differs from sorted-asc order [a, b, c].
    // If docsRef tracks insertion order (the bug), ArrowDown from row 0 of
    // the sorted view (cell 'a') resolves to insertion[1] = {k:'a'} — the
    // SAME doc the user just selected. With the fix, ArrowDown resolves to
    // sorted[1] = {k:'b'} — the next visible row.
    const docs = [
      { k: 'b', tag: 'tag-b' },
      { k: 'a', tag: 'tag-a' },
      { k: 'c', tag: 'tag-c' },
    ];
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs }],
          isRunning: false,
          executionMs: 1,
        },
      },
    });

    // Spy on the F3/cell.viewRecord action so we can observe which doc the
    // record-action layer received without rendering the modal body.
    const viewAction = recordActionRegistry.getById('cell.viewRecord')!;
    expect(viewAction).toBeDefined();
    const captured: unknown[] = [];
    const executeSpy = vi
      .spyOn(viewAction, 'execute')
      .mockImplementation((ctx) => { captured.push(ctx.doc); });

    try {
      const user = userEvent.setup();
      render(<ResultsPanel tabId="t1" pageSize={50} />);

      // Default view is 'table'. Click the 'k' column header to sort ascending.
      // Display order becomes [a, b, c].
      const headers = screen.getAllByRole('columnheader');
      const kHeader = headers.find((h) => h.textContent?.trim().startsWith('k'))!;
      await user.click(kHeader);

      // Click the cell rendering 'a' — display-order row 0.
      const cellA = screen.getAllByRole('cell').find((c) => c.textContent === 'a')!;
      await user.click(cellA);

      // Move down one row in display order.
      await user.keyboard('{ArrowDown}');

      // Fire F3 → cell.viewRecord with the selected doc.
      await user.keyboard('{F3}');

      expect(captured).toHaveLength(1);
      // With the bug this would be { k: 'a', tag: 'tag-a' } (insertion-order
      // docsRef[1]). The fix routes the active view's rendered docs into
      // docsRef so we get { k: 'b', tag: 'tag-b' }.
      expect(captured[0]).toMatchObject({ k: 'b', tag: 'tag-b' });
    } finally {
      executeSpy.mockRestore();
    }
  });
});
