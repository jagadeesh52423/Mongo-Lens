import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionPanel } from '../ConnectionPanel';
import { ConnectionTree } from '../ConnectionTree';
import { useConnectionsV2 } from '../useConnectionsV2';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConnectionsV2.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(), loading: false,
  });
});

describe('ConnectionTree schema icon', () => {
  it('calls onOpenSchema when the collection schema icon is clicked', async () => {
    const onOpenSchema = vi.fn();
    invokeMock
      .mockResolvedValueOnce(['testdb'])
      .mockResolvedValueOnce([{ name: 'users' }]);

    render(
      <ConnectionTree
        connectionId="c1"
        onOpenCollection={() => {}}
        onOpenSchema={onOpenSchema}
      />
    );

    await waitFor(() => screen.getByText('testdb'));
    fireEvent.click(screen.getByText('testdb'));
    await waitFor(() => screen.getByText('users'));

    const icon = await screen.findByRole('button', { name: /analyze schema for users/i });
    fireEvent.click(icon);

    expect(onOpenSchema).toHaveBeenCalledWith('testdb', 'users');
  });
});

describe('ConnectionTree right-click context menu', () => {
  it('right-clicking a collection row opens a menu with Open collection and Analyze schema items', async () => {
    const onOpenSchema = vi.fn();
    const onOpenCollection = vi.fn();
    invokeMock
      .mockResolvedValueOnce(['testdb'])
      .mockResolvedValueOnce([{ name: 'orders' }]);

    render(
      <ConnectionTree
        connectionId="c2"
        onOpenCollection={onOpenCollection}
        onOpenSchema={onOpenSchema}
      />
    );

    await waitFor(() => screen.getByText('testdb'));
    fireEvent.click(screen.getByText('testdb'));
    await waitFor(() => screen.getByText('orders'));

    fireEvent.contextMenu(screen.getByText('orders'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Analyze schema' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open collection' })).toBeInTheDocument();
  });

  it('clicking Analyze schema in the context menu calls onOpenSchema and closes the menu', async () => {
    const onOpenSchema = vi.fn();
    invokeMock
      .mockResolvedValueOnce(['testdb'])
      .mockResolvedValueOnce([{ name: 'orders' }]);

    render(
      <ConnectionTree
        connectionId="c3"
        onOpenCollection={() => {}}
        onOpenSchema={onOpenSchema}
      />
    );

    await waitFor(() => screen.getByText('testdb'));
    fireEvent.click(screen.getByText('testdb'));
    await waitFor(() => screen.getByText('orders'));

    fireEvent.contextMenu(screen.getByText('orders'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Analyze schema' }));

    expect(onOpenSchema).toHaveBeenCalledWith('testdb', 'orders');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('ConnectionPanel env color dot (read from useConnectionsV2)', () => {
  it('shows the env color dot for a connected connection that has a color', async () => {
    useConnectionsV2.setState({ connectedIds: new Set(['1']) });
    invokeMock
      .mockResolvedValueOnce([{
        id: '1', name: 'prod-db', color: '#ef4444',
        target: { kind: 'direct', host: 'h', port: 27017 },
        auth: { kind: 'none' },
        createdAt: '2026-01-01T00:00:00Z',
      }])
      .mockResolvedValueOnce(undefined);

    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('prod-db')).toBeInTheDocument());
    const dot = screen.getByTestId('cl-env-1');
    expect(dot.style.background).toMatch(/#ef4444|rgb\(239, ?68, ?68\)/);
  });

  it('omits the inline color (falls back) when a connected connection has none', async () => {
    useConnectionsV2.setState({ connectedIds: new Set(['2']) });
    invokeMock
      .mockResolvedValueOnce([{
        id: '2', name: 'no-tag',
        target: { kind: 'direct', host: 'h', port: 27017 },
        auth: { kind: 'none' },
        createdAt: '2026-01-01T00:00:00Z',
      }])
      .mockResolvedValueOnce(undefined);

    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('no-tag')).toBeInTheDocument());
    const dot = screen.getByTestId('cl-env-2');
    expect(dot.style.background).toBe('');
  });
});
