import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionTree } from '../components/features/connections/ConnectionTree';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
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
});
