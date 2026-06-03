import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { SshTab } from '../SshTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

const base: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

function renderSsh(value: Connection, onChange = vi.fn(), secrets: Record<string, string> = {}, onSecretChange = vi.fn()) {
  render(
    <SshTab
      value={value}
      onChange={onChange}
      globals={DEFAULT_GLOBAL_PREFS}
      secrets={secrets}
      onSecretChange={onSecretChange}
    />,
  );
  return { onChange, onSecretChange };
}

describe('SshTab', () => {
  it('shows SSH host field even when disabled', () => {
    renderSsh(base);
    expect(screen.getByLabelText(/ssh host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enable ssh tunnel/i)).not.toBeChecked();
  });

  it('typing a host materializes a disabled tunnel (enabled stays false)', () => {
    const { onChange } = renderSsh(base);
    fireEvent.change(screen.getByLabelText(/ssh host/i), { target: { value: 'jump' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ssh: expect.objectContaining({ enabled: false, host: 'jump' }),
      }),
    );
  });

  it('toggling enable preserves typed host', () => {
    const { onChange } = renderSsh({
      ...base,
      ssh: { enabled: false, host: 'jump', port: 22, user: 'me', auth: { kind: 'password' }, knownHostsPolicy: 'strict' },
    });
    fireEvent.click(screen.getByLabelText(/enable ssh tunnel/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ssh: expect.objectContaining({ enabled: true, host: 'jump' }),
      }),
    );
  });

  it('reveals the passphrase field only when key + hasPassphrase are set', () => {
    renderSsh({
      ...base,
      ssh: { enabled: true, host: 'h', port: 22, user: 'u', auth: { kind: 'key', keyPath: '/k', hasPassphrase: true }, knownHostsPolicy: 'strict' },
    });
    expect(screen.getByLabelText(/^passphrase$/i)).toBeInTheDocument();
  });

  it('switching auth method to "agent" zeros incompatible fields', () => {
    const { onChange } = renderSsh({
      ...base,
      ssh: { enabled: true, host: 'h', port: 22, user: 'u', auth: { kind: 'password' }, knownHostsPolicy: 'strict' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /ssh agent/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ssh: expect.objectContaining({ auth: { kind: 'agent' } }),
      }),
    );
  });

  it('known-hosts policy dropdown switches policy', () => {
    const { onChange } = renderSsh({
      ...base,
      ssh: { enabled: true, host: 'h', port: 22, user: 'u', auth: { kind: 'password' }, knownHostsPolicy: 'strict' },
    });
    fireEvent.change(screen.getByLabelText(/host key policy/i), { target: { value: 'add-and-trust' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ssh: expect.objectContaining({ knownHostsPolicy: 'add-and-trust' }),
      }),
    );
  });
});
