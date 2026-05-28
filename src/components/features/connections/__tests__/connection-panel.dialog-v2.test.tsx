import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionPanel } from '../ConnectionPanel';
import { useConnectionsV2 } from '../useConnectionsV2';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConnectionsV2.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(), loading: false,
  });
});

describe('ConnectionPanel — v2 dialog is the default', () => {
  it('renders ConnectionDialogV2 when Add is clicked (no escape hatch needed)', async () => {
    // connections_v2_list → empty; prefs_get → defaults
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        intelliShell: { commandTimeoutMs: 30000, autoCompleteEnabled: true, printLimit: 1000 },
        tools: {
          mongodumpPath: '/usr/bin/mongodump',
          mongorestorePath: '/usr/bin/mongorestore',
          mongoexportPath: '/usr/bin/mongoexport',
          mongoimportPath: '/usr/bin/mongoimport',
        },
        advanced: {
          appName: 'mongo-lens', retryWrites: true, retryReads: true,
          compressors: ['snappy'],
          serverSelectionTimeoutMs: 30000, connectTimeoutMs: 10000, socketTimeoutMs: 0,
        },
      });

    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections_v2_list'));
    await user.click(screen.getByLabelText('Add connection'));

    // The v2 dialog uses aria-label="Connection editor".
    expect(await screen.findByRole('dialog', { name: /connection editor/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/connection name/i)).toBeInTheDocument();
  });
});
