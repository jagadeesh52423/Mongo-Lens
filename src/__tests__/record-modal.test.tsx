import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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
    fireEvent.change(ta, { target: { value: '{"name":"Bob","age":31}' } });
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
    fireEvent.change(ta, { target: { value: '{bad json' } });
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
