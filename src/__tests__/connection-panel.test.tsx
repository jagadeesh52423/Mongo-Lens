import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionPanel, nextDuplicateName } from '../components/features/connections/ConnectionPanel';
import { useConnectionsStore } from '../store/connections';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
});

describe('ConnectionPanel', () => {
  it('loads connections on mount', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'local', host: 'localhost', port: 27017, createdAt: 't' },
    ]);
    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('local')).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith('list_connections');
  });

  it('opens the v2 add dialog', async () => {
    // list_connections → []; connections_v2_list → []; prefs_get → undefined
    // (ConnectionPanel falls back to DEFAULT_GLOBAL_PREFS).
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await user.click(screen.getByLabelText('Add connection'));
    expect(
      await screen.findByRole('dialog', { name: /connection editor/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/connection name/i)).toBeInTheDocument();
  });

  it('duplicates a connection via the right-click menu with smart naming', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'test', host: 'localhost', port: 27017, createdAt: 't' },
      { id: '2', name: 'test(1)', host: 'localhost', port: 27017, createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('test(1)')).toBeInTheDocument());

    invokeMock.mockResolvedValueOnce({
      id: '3', name: 'test(2)', host: 'localhost', port: 27017, createdAt: 't',
    });
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('test') });
    await user.click(screen.getByText('Duplicate'));

    await waitFor(() => expect(screen.getByText('test(2)')).toBeInTheDocument());
    expect(invokeMock).toHaveBeenLastCalledWith('create_connection', {
      input: expect.objectContaining({ name: 'test(2)', host: 'localhost', port: 27017 }),
    });
  });
});

describe('nextDuplicateName', () => {
  it('returns base(1) when only the bare name exists', () => {
    expect(nextDuplicateName('test', ['test'])).toBe('test(1)');
  });
  it('picks the next free index, ignoring gaps', () => {
    expect(nextDuplicateName('test', ['test', 'test(2)'])).toBe('test(3)');
  });
  it('treats a duplicate of an indexed copy the same as the base', () => {
    expect(nextDuplicateName('test(1)', ['test', 'test(1)'])).toBe('test(2)');
  });
  it('returns base(1) when nothing matches', () => {
    expect(nextDuplicateName('test', ['other'])).toBe('test(1)');
  });
  it('escapes regex-special characters in the base name', () => {
    expect(nextDuplicateName('a.b+c', ['a.b+c'])).toBe('a.b+c(1)');
  });
});
