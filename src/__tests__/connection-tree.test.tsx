import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionTree } from '../components/features/connections/ConnectionTree';
import { ConnectionList } from '../components/features/connections/ConnectionList';
import type { Connection } from '../connection/model';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

const conn = (id: string, name: string, extra: Partial<Connection> = {}): Connection => ({
  id,
  name,
  target: { kind: 'direct', host: 'localhost', port: 27017 },
  auth: { kind: 'none' },
  createdAt: 't',
  ...extra,
});

describe('ConnectionTree', () => {
  it('lists databases and lazily loads collections', async () => {
    invokeMock
      .mockResolvedValueOnce(['mydb', 'otherdb'])
      .mockResolvedValueOnce([{ name: 'users' }, { name: 'orders' }]);

    const user = userEvent.setup();
    render(<ConnectionTree connectionId="c1" onOpenCollection={() => {}} />);

    await waitFor(() => expect(screen.getByText('mydb')).toBeInTheDocument());
    await user.click(screen.getByText('mydb'));
    await waitFor(() => expect(screen.getByText('users')).toBeInTheDocument());
  });

  it('ArrowDown in tree does not move ConnectionList prefix highlight', async () => {
    // Mock scrollIntoView to prevent jsdom errors
    Element.prototype.scrollIntoView = vi.fn();

    // Mock two calls: listDatabases and listCollections
    invokeMock
      .mockResolvedValueOnce(['testdb'])  // listDatabases
      .mockResolvedValueOnce([           // listCollections
        { name: 'users' },
        { name: 'orders' },
      ]);

    const user = userEvent.setup();

    // Render ConnectionList with one connected+expanded connection and one disconnected
    render(
      <ConnectionList
        connections={[conn('1', 'connected-conn'), conn('2', 'idle-conn')]}
        connectedIds={new Set(['1'])}
        expandedConns={new Set(['1'])}
        onConnect={vi.fn()}
        onToggleExpanded={vi.fn()}
        onItemContextMenu={vi.fn()}
        renderTree={(connectionId) => (
          <ConnectionTree
            connectionId={connectionId}
            onOpenCollection={vi.fn()}
          />
        )}
      />,
    );

    // Tree renders inside the expanded connection row
    await waitFor(() => expect(screen.getByText('testdb')).toBeInTheDocument());

    // Expand the database in the tree by clicking it
    await user.click(screen.getByText('testdb'));
    await waitFor(() => expect(screen.getByText('users')).toBeInTheDocument());

    // Get the tree wrapper and focus it to activate keyboard handling
    const usersElement = screen.getByText('users');
    const treeWrapper = usersElement.closest('div[tabindex]');
    expect(treeWrapper).toBeTruthy();
    (treeWrapper as HTMLElement)?.focus();

    // Press arrow down to move selection within the tree to the first collection
    // With the fix, e.stopPropagation() prevents this from bubbling to ConnectionList
    await user.keyboard('{ArrowDown}');

    // Verify tree selection moved (positive assertion: users collection is now selected)
    const usersRow = screen.getByText('users').closest('div');
    expect(usersRow).toHaveClass('list-row-focused');

    // Verify ConnectionList rows did NOT get the prefix highlight
    // If the bug existed (no stopPropagation), pressing ArrowDown would bubble up to
    // ConnectionList's handleWrapperKeyDown and move the prefix highlight to idle-conn
    const connectedRow = screen.getByTestId('cl-row-1');
    expect(connectedRow).not.toHaveAttribute('data-highlighted');

    const idleRow = screen.getByTestId('cl-row-2');
    expect(idleRow).not.toHaveAttribute('data-highlighted');
  });

  it('ArrowUp in tree does not move ConnectionList prefix highlight', async () => {
    // Mock scrollIntoView to prevent jsdom errors
    Element.prototype.scrollIntoView = vi.fn();

    // Mock two calls: listDatabases and listCollections
    invokeMock
      .mockResolvedValueOnce(['testdb'])  // listDatabases
      .mockResolvedValueOnce([           // listCollections
        { name: 'users' },
        { name: 'orders' },
      ]);

    const user = userEvent.setup();

    // Render ConnectionList with one connected+expanded connection and one disconnected
    render(
      <ConnectionList
        connections={[conn('1', 'connected-conn'), conn('2', 'idle-conn')]}
        connectedIds={new Set(['1'])}
        expandedConns={new Set(['1'])}
        onConnect={vi.fn()}
        onToggleExpanded={vi.fn()}
        onItemContextMenu={vi.fn()}
        renderTree={(connectionId) => (
          <ConnectionTree
            connectionId={connectionId}
            onOpenCollection={vi.fn()}
          />
        )}
      />,
    );

    // Tree renders inside the expanded connection row
    await waitFor(() => expect(screen.getByText('testdb')).toBeInTheDocument());

    // Expand the database in the tree by clicking it
    await user.click(screen.getByText('testdb'));
    await waitFor(() => expect(screen.getByText('users')).toBeInTheDocument());

    // Get the tree wrapper and focus it to activate keyboard handling
    const usersElement = screen.getByText('users');
    const treeWrapper = usersElement.closest('div[tabindex]');
    expect(treeWrapper).toBeTruthy();
    (treeWrapper as HTMLElement)?.focus();

    // First select the first collection (users) with ArrowDown from unselected state (-1)
    await user.keyboard('{ArrowDown}');
    const usersRow = screen.getByText('users').closest('div');
    expect(usersRow).toHaveClass('list-row-focused');

    // Press arrow up while first collection is selected — should clamp at 0 (stay at users)
    await user.keyboard('{ArrowUp}');

    // Verify tree selection stayed at first collection (users)
    expect(usersRow).toHaveClass('list-row-focused');

    // Verify ConnectionList rows did NOT get the prefix highlight
    // If the bug existed (no stopPropagation), pressing ArrowUp would bubble up to
    // ConnectionList's handleWrapperKeyDown and move the prefix highlight
    const connectedRow = screen.getByTestId('cl-row-1');
    expect(connectedRow).not.toHaveAttribute('data-highlighted');

    const idleRow = screen.getByTestId('cl-row-2');
    expect(idleRow).not.toHaveAttribute('data-highlighted');
  });

  it('ArrowUp in tree with no selection selects first collection', async () => {
    // Mock scrollIntoView to prevent jsdom errors
    Element.prototype.scrollIntoView = vi.fn();

    // Mock two calls: listDatabases and listCollections
    invokeMock
      .mockResolvedValueOnce(['testdb'])  // listDatabases
      .mockResolvedValueOnce([           // listCollections
        { name: 'users' },
        { name: 'orders' },
      ]);

    const user = userEvent.setup();

    // Render ConnectionList with one connected+expanded connection
    render(
      <ConnectionList
        connections={[conn('1', 'connected-conn')]}
        connectedIds={new Set(['1'])}
        expandedConns={new Set(['1'])}
        onConnect={vi.fn()}
        onToggleExpanded={vi.fn()}
        onItemContextMenu={vi.fn()}
        renderTree={(connectionId) => (
          <ConnectionTree
            connectionId={connectionId}
            onOpenCollection={vi.fn()}
          />
        )}
      />,
    );

    // Tree renders inside the expanded connection row
    await waitFor(() => expect(screen.getByText('testdb')).toBeInTheDocument());

    // Expand the database in the tree by clicking it
    await user.click(screen.getByText('testdb'));
    await waitFor(() => expect(screen.getByText('users')).toBeInTheDocument());

    // Get the tree wrapper and focus it
    const usersElement = screen.getByText('users');
    const treeWrapper = usersElement.closest('div[tabindex]');
    expect(treeWrapper).toBeTruthy();
    (treeWrapper as HTMLElement)?.focus();

    // Press arrow up from unselected state — should jump to first collection (index 0)
    await user.keyboard('{ArrowUp}');

    // Verify tree selection moved to first collection (users)
    const usersRow = screen.getByText('users').closest('div');
    expect(usersRow).toHaveClass('list-row-focused');

    // Verify no bubbling to ConnectionList
    const connectedRow = screen.getByTestId('cl-row-1');
    expect(connectedRow).not.toHaveAttribute('data-highlighted');
  });
});
