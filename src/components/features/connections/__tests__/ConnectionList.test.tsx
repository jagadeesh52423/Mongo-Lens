import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionList } from '../ConnectionList';
import type { Connection } from '../../../../connection/model';

const conn = (id: string, name: string, extra: Partial<Connection> = {}): Connection => ({
  id,
  name,
  target: { kind: 'direct', host: 'localhost', port: 27017 },
  auth: { kind: 'none' },
  createdAt: 't',
  ...extra,
});

function setup(over: Partial<React.ComponentProps<typeof ConnectionList>> = {}) {
  const onConnect = vi.fn();
  const onToggleExpanded = vi.fn();
  const onItemContextMenu = vi.fn();
  render(
    <ConnectionList
      connections={over.connections ?? [conn('1', 'local-dev')]}
      connectedIds={over.connectedIds ?? new Set()}
      expandedConns={over.expandedConns ?? new Set()}
      onConnect={onConnect}
      onToggleExpanded={onToggleExpanded}
      onItemContextMenu={onItemContextMenu}
      {...over}
    />,
  );
  return { onConnect, onToggleExpanded, onItemContextMenu };
}

describe('ConnectionList — skeleton', () => {
  it('renders each connection name and target summary', () => {
    setup({
      connections: [
        conn('1', 'local'),
        conn('2', 'prod', { target: { kind: 'uri', uri: 'mongodb+srv://prod' } }),
      ],
    });
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText('localhost:27017')).toBeInTheDocument();
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('mongodb+srv://prod')).toBeInTheDocument();
  });

  it('shows an SSH badge when the connection is tunneled', () => {
    setup({
      connections: [
        conn('1', 'tunneled', {
          ssh: {
            enabled: true,
            host: 'bastion',
            port: 22,
            user: 'me',
            auth: { kind: 'agent' },
            knownHostsPolicy: 'strict',
          },
        }),
      ],
    });
    expect(screen.getByLabelText('SSH tunnel')).toBeInTheDocument();
  });

  it('shows an empty message when there are no connections', () => {
    setup({ connections: [] });
    expect(screen.getByText(/no saved connections yet/i)).toBeInTheDocument();
  });

  it('calls onConnect when clicking an available (not connected) row', async () => {
    const user = userEvent.setup();
    const { onConnect } = setup();
    await user.click(screen.getByText('local-dev'));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('calls onToggleExpanded when clicking a connected row', async () => {
    const user = userEvent.setup();
    const { onToggleExpanded } = setup({ connectedIds: new Set(['1']) });
    await user.click(screen.getByText('local-dev'));
    expect(onToggleExpanded).toHaveBeenCalledWith('1');
  });

  it('does not call onConnect for a connected row', async () => {
    const user = userEvent.setup();
    const { onConnect } = setup({ connectedIds: new Set(['1']) });
    await user.click(screen.getByText('local-dev'));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows the live indicator for connected connections', () => {
    setup({ connectedIds: new Set(['1']) });
    expect(screen.getByLabelText('Connected')).toBeInTheDocument();
  });

  it('does not show a live indicator for available connections', () => {
    setup({ connectedIds: new Set() });
    expect(screen.queryByLabelText('Connected')).not.toBeInTheDocument();
  });

  it('shows a down caret when a connected item is expanded', () => {
    setup({ connectedIds: new Set(['1']), expandedConns: new Set(['1']) });
    expect(screen.getByTestId('cl-row-1').textContent).toContain('▾');
  });

  it('shows a right caret when a connected item is collapsed', () => {
    setup({ connectedIds: new Set(['1']), expandedConns: new Set() });
    expect(screen.getByTestId('cl-row-1').textContent).toContain('▸');
  });

  it('renders the tree slot when expanded and renderTree is provided', () => {
    setup({
      connectedIds: new Set(['1']),
      expandedConns: new Set(['1']),
      renderTree: (id) => <div data-testid={`tree-${id}`}>tree content</div>,
    });
    expect(screen.getByTestId('tree-1')).toBeInTheDocument();
  });

  it('does not render the tree slot when collapsed', () => {
    setup({
      connectedIds: new Set(['1']),
      expandedConns: new Set(),
      renderTree: (id) => <div data-testid={`tree-${id}`}>tree content</div>,
    });
    expect(screen.queryByTestId('tree-1')).not.toBeInTheDocument();
  });

  it('calls onItemContextMenu with the connection and pointer coords on right-click', async () => {
    const user = userEvent.setup();
    const { onItemContextMenu } = setup();
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('local-dev') });
    expect(onItemContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1' }),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('activates the row via keyboard Enter', async () => {
    const user = userEvent.setup();
    const { onConnect } = setup();
    await user.tab(); // focuses search input
    await user.tab(); // focuses first row
    await user.keyboard('{Enter}');
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });
});

describe('ConnectionList — sections', () => {
  it('shows an "Active" section label when there are connected items', () => {
    setup({ connectedIds: new Set(['1']) });
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('does not show a section label when nothing is connected', () => {
    setup({ connectedIds: new Set() });
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows "Available" section label only when both active and available items exist', () => {
    setup({
      connections: [conn('1', 'live'), conn('2', 'idle')],
      connectedIds: new Set(['1']),
    });
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('does not show "Available" section label when all connections are available', () => {
    setup({
      connections: [conn('1', 'alpha'), conn('2', 'beta')],
      connectedIds: new Set(),
    });
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
  });

  it('renders a search input', () => {
    setup();
    expect(screen.getByRole('searchbox', { name: /filter connections/i })).toBeInTheDocument();
  });
});

describe('ConnectionList — search filter', () => {
  it('shows only matching connections when a query is typed', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'local-dev'), conn('2', 'prod-east')],
    });
    await user.type(screen.getByRole('searchbox'), 'prod');
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
    expect(screen.getByText('prod-east')).toBeInTheDocument();
  });

  it('restores full list when query is cleared', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'local-dev'), conn('2', 'prod-east')],
    });
    const input = screen.getByRole('searchbox');
    await user.type(input, 'prod');
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
    await user.clear(input);
    expect(screen.getByText('local-dev')).toBeInTheDocument();
    expect(screen.getByText('prod-east')).toBeInTheDocument();
  });

  it('shows a "no matches" message when filter has no results', async () => {
    const user = userEvent.setup();
    setup({ connections: [conn('1', 'local-dev')] });
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText(/no connections match/i)).toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    const user = userEvent.setup();
    setup({ connections: [conn('1', 'Production')] });
    await user.type(screen.getByRole('searchbox'), 'prod');
    expect(screen.getByText('Production')).toBeInTheDocument();
  });

  it('matches connections in both Active and Available sections', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'prod-live'), conn('2', 'prod-idle')],
      connectedIds: new Set(['1']),
    });
    await user.type(screen.getByRole('searchbox'), 'prod');
    expect(screen.getByText('prod-live')).toBeInTheDocument();
    expect(screen.getByText('prod-idle')).toBeInTheDocument();
  });
});

describe('ConnectionList — auto-collapse when searching', () => {
  it('hides the tree slot for expanded active items while a query is active', async () => {
    const user = userEvent.setup();
    setup({
      connectedIds: new Set(['1']),
      expandedConns: new Set(['1']),
      renderTree: (id) => <div data-testid={`tree-${id}`}>tree</div>,
    });
    // Tree visible before searching.
    expect(screen.getByTestId('tree-1')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'local');
    // Tree auto-collapses while filter is active.
    expect(screen.queryByTestId('tree-1')).not.toBeInTheDocument();
  });

  it('restores expanded tree when query is cleared', async () => {
    const user = userEvent.setup();
    setup({
      connectedIds: new Set(['1']),
      expandedConns: new Set(['1']),
      renderTree: (id) => <div data-testid={`tree-${id}`}>tree</div>,
    });
    const input = screen.getByRole('searchbox');
    await user.type(input, 'local');
    expect(screen.queryByTestId('tree-1')).not.toBeInTheDocument();
    await user.clear(input);
    expect(screen.getByTestId('tree-1')).toBeInTheDocument();
  });
});

describe('ConnectionList — keyboard prefix navigation', () => {
  it('highlights the first connection matching a typed prefix', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'alpha'), conn('2', 'beta'), conn('3', 'gamma')],
    });
    // Tab past search to land focus inside the list area, then type
    const row1 = screen.getByTestId('cl-row-1');
    row1.focus();
    await user.keyboard('b');
    expect(screen.getByTestId('cl-row-2')).toHaveAttribute('data-highlighted');
  });

  it('extends the prefix buffer to refine the match', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'prod-east'), conn('2', 'prod-west'), conn('3', 'staging')],
    });
    screen.getByTestId('cl-row-1').focus();
    await user.keyboard('p');
    expect(screen.getByTestId('cl-row-1')).toHaveAttribute('data-highlighted');
    await user.keyboard('r');
    // 'pr' still matches prod-east (first)
    expect(screen.getByTestId('cl-row-1')).toHaveAttribute('data-highlighted');
  });

  it('does not trigger prefix nav when the search input is focused', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'alpha'), conn('2', 'beta')],
    });
    // Focus the search input, type a letter — should update the search filter, not prefix nav
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('b');
    // beta should still be visible (search matched it), alpha hidden
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    // No prefix highlight applied to any row
    expect(screen.getByTestId('cl-row-2')).not.toHaveAttribute('data-highlighted');
  });

  it('matches only within the current filtered set when search is also active', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'prod-alpha'), conn('2', 'prod-beta'), conn('3', 'staging')],
    });
    // Filter to prod-* via search box
    await user.type(screen.getByRole('searchbox'), 'prod');
    // staging is not in DOM; prefix 'p' matches prod-alpha
    screen.getByTestId('cl-row-1').focus();
    await user.keyboard('p');
    expect(screen.getByTestId('cl-row-1')).toHaveAttribute('data-highlighted');
  });

  it('clears prefix highlight on Escape', async () => {
    const user = userEvent.setup();
    setup({
      connections: [conn('1', 'alpha'), conn('2', 'beta')],
    });
    screen.getByTestId('cl-row-1').focus();
    await user.keyboard('b');
    expect(screen.getByTestId('cl-row-2')).toHaveAttribute('data-highlighted');
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('cl-row-2')).not.toHaveAttribute('data-highlighted');
  });
});
