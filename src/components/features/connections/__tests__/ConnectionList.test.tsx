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
    await user.tab(); // focus first row
    await user.keyboard('{Enter}');
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });
});
