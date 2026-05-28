import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionPanel } from '../ConnectionPanel';
import { useConnectionsStore } from '../../../../store/connections';
import { useConnectionsV2 } from '../useConnectionsV2';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
  useConnectionsV2.setState({ connections: [], loading: false });
});

describe('ConnectionPanel color stripe (read from useConnectionsV2)', () => {
  it('renders the env color stripe when v2 connection has a color', async () => {
    // First call: list_connections (legacy). Second: connections_v2_list (v2).
    invokeMock
      .mockResolvedValueOnce([{ id: '1', name: 'prod-db', host: 'h', port: 27017, createdAt: 't' }])
      .mockResolvedValueOnce([{
        id: '1', name: 'prod-db', color: '#ef4444',
        target: { kind: 'direct', host: 'h', port: 27017 },
        auth: { kind: 'none' },
        createdAt: '2026-01-01T00:00:00Z',
      }]);

    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('prod-db')).toBeInTheDocument());
    await waitFor(() => {
      const row = screen.getByTestId('conn-row-1');
      expect(row.style.borderLeftColor).toMatch(/#ef4444|rgb\(239, ?68, ?68\)/);
    });
  });

  it('omits the inline color when v2 connection has no color', async () => {
    invokeMock
      .mockResolvedValueOnce([{ id: '2', name: 'no-tag', host: 'h', port: 27017, createdAt: 't' }])
      .mockResolvedValueOnce([{
        id: '2', name: 'no-tag',
        target: { kind: 'direct', host: 'h', port: 27017 },
        auth: { kind: 'none' },
        createdAt: '2026-01-01T00:00:00Z',
      }]);

    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('no-tag')).toBeInTheDocument());
    const row = screen.getByTestId('conn-row-2');
    // No inline borderLeftColor → falls back to CSS transparent
    expect(row.style.borderLeftColor).toBe('');
  });
});
