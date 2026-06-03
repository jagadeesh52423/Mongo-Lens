import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectLauncher } from '../ConnectLauncher';
import type { Connection } from '../../../../connection/model';

const conn = (id: string, name: string, extra: Partial<Connection> = {}): Connection => ({
  id, name,
  target: { kind: 'direct', host: 'localhost', port: 27017 },
  auth: { kind: 'none' },
  createdAt: 't',
  ...extra,
});

function setup(over: Partial<React.ComponentProps<typeof ConnectLauncher>> = {}) {
  const onConnect = vi.fn();
  const onNewConnection = vi.fn();
  const onItemContextMenu = vi.fn();
  render(
    <ConnectLauncher
      available={over.available ?? [conn('1', 'local-dev')]}
      hasAnySaved={over.hasAnySaved ?? true}
      onConnect={onConnect}
      onNewConnection={onNewConnection}
      onItemContextMenu={onItemContextMenu}
    />,
  );
  return { onConnect, onNewConnection, onItemContextMenu };
}

describe('ConnectLauncher', () => {
  it('starts closed and opens on trigger click', async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole('button', { name: 'Connect' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('local-dev')).toBeInTheDocument();
  });

  it('renders each available connection with its target subtitle', async () => {
    const user = userEvent.setup();
    setup({ available: [conn('1', 'local-dev'), conn('2', 'prod', { target: { kind: 'uri', uri: 'mongodb+srv://prod.acme' } })] });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText('localhost:27017')).toBeInTheDocument();
    expect(screen.getByText('mongodb+srv://prod.acme')).toBeInTheDocument();
  });

  it('shows an SSH badge when the connection is tunneled', async () => {
    const user = userEvent.setup();
    setup({ available: [conn('1', 'tunneled', { ssh: { enabled: true, host: 'bastion', port: 22, user: 'me', auth: { kind: 'agent' }, knownHostsPolicy: 'strict' } })] });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText('SSH')).toBeInTheDocument();
  });

  it('calls onConnect and closes when an item is clicked', async () => {
    const user = userEvent.setup();
    const { onConnect } = setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.click(screen.getByText('local-dev'));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
  });

  it('calls onItemContextMenu and closes on right-click of an item', async () => {
    const user = userEvent.setup();
    const { onItemContextMenu } = setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('local-dev') });
    expect(onItemContextMenu).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), expect.any(Number), expect.any(Number));
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
  });

  it('calls onNewConnection from the New connection entry', async () => {
    const user = userEvent.setup();
    const { onNewConnection } = setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.click(screen.getByText(/new connection/i));
    expect(onNewConnection).toHaveBeenCalledTimes(1);
  });

  it('navigates items with arrow keys and activates with Enter', async () => {
    const user = userEvent.setup();
    const { onConnect } = setup({ available: [conn('1', 'alpha'), conn('2', 'beta')] });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.keyboard('{ArrowDown}{Enter}'); // active 0→1, Enter selects 'beta'
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText('local-dev')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
  });

  it('shows the "no saved" note when nothing is saved', async () => {
    const user = userEvent.setup();
    setup({ available: [], hasAnySaved: false });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText(/no saved connections yet/i)).toBeInTheDocument();
  });

  it('shows the "all active" note when saved exist but none are available', async () => {
    const user = userEvent.setup();
    setup({ available: [], hasAnySaved: true });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText(/all connections are active/i)).toBeInTheDocument();
  });
});
