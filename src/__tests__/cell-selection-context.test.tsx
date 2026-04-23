import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellSelectionProvider, useCellSelection } from '../contexts/CellSelectionContext';

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
