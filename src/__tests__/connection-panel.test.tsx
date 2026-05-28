import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionPanel, nextDuplicateName } from '../components/features/connections/ConnectionPanel';
import { useConnectionsV2 } from '../components/features/connections/useConnectionsV2';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConnectionsV2.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(), loading: false,
  });
});

const v2Conn = (id: string, name: string) => ({
  id, name,
  target: { kind: 'direct', host: 'localhost', port: 27017 },
  auth: { kind: 'none' },
  createdAt: 't',
});

describe('ConnectionPanel', () => {
  it('loads connections on mount via the v2 list IPC', async () => {
    invokeMock
      .mockResolvedValueOnce([v2Conn('1', 'local')])  // connections_v2_list
      .mockResolvedValueOnce(undefined);              // prefs_get
    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('local')).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith('connections_v2_list');
  });

  it('opens the v2 add dialog', async () => {
    // connections_v2_list → []; prefs_get → undefined (ConnectionPanel falls
    // back to DEFAULT_GLOBAL_PREFS).
    invokeMock
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
    // Mount: connections_v2_list → 2 rows; prefs_get → undefined.
    invokeMock
      .mockResolvedValueOnce([v2Conn('1', 'test'), v2Conn('2', 'test(1)')])
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('test(1)')).toBeInTheDocument());

    // Duplicate triggers saveV2 (returns the new connection) → refresh()
    // (returns the updated list including the duplicate).
    invokeMock
      .mockResolvedValueOnce(v2Conn('3', 'test(2)'))  // connections_v2_save
      .mockResolvedValueOnce([                         // connections_v2_list
        v2Conn('1', 'test'), v2Conn('2', 'test(1)'), v2Conn('3', 'test(2)'),
      ]);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('test') });
    await user.click(screen.getByText('Duplicate'));

    await waitFor(() => expect(screen.getByText('test(2)')).toBeInTheDocument());
    // saveV2 was called with a SaveInput whose connection cloned from 'test'
    // but with empty id (server gen) and the next free name.
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === 'connections_v2_save');
    expect(saveCall).toBeDefined();
    expect(saveCall![1].input.connection).toMatchObject({ id: '', name: 'test(2)' });
    expect(saveCall![1].input.secrets).toEqual([]);
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
