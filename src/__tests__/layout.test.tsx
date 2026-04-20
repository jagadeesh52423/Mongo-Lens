import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import App from '../App';
import { useConnectionsStore } from '../store/connections';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
});

describe('App shell', () => {
  it('renders icon rail with three buttons', () => {
    render(<App />);
    expect(screen.getByLabelText('Connections')).toBeInTheDocument();
    expect(screen.getByLabelText('Saved Scripts')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
    expect(screen.queryByLabelText('Collections')).not.toBeInTheDocument();
  });

  it('toggles side panel when icon clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText('Saved Scripts'));
    expect(screen.getByTestId('side-panel-title')).toHaveTextContent('Saved Scripts');
  });
});
