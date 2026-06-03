import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProxyTab } from '../ProxyTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

const base: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

function renderProxy(value: Connection, onChange = vi.fn(), secrets: Record<string, string> = {}, onSecretChange = vi.fn()) {
  render(
    <ProxyTab
      value={value}
      onChange={onChange}
      globals={DEFAULT_GLOBAL_PREFS}
      secrets={secrets}
      onSecretChange={onSecretChange}
    />,
  );
  return { onChange, onSecretChange };
}

describe('ProxyTab', () => {
  it('shows proxy host field even when disabled, toggle off', () => {
    renderProxy(base);
    expect(screen.getByLabelText(/^host$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enable proxy/i)).not.toBeChecked();
  });

  it('toggling enable preserves typed host', () => {
    const { onChange } = renderProxy({ ...base, proxy: { enabled: false, kind: 'socks5', host: '10.0.0.1', port: 1080 } });
    fireEvent.click(screen.getByLabelText(/enable proxy/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: expect.objectContaining({ enabled: true, host: '10.0.0.1' }),
      }),
    );
  });

  it('selecting HTTP shows the SOCKS5-only warning', () => {
    renderProxy({ ...base, proxy: { enabled: true, kind: 'http', host: 'p', port: 8080 } });
    expect(screen.getByRole('alert')).toHaveTextContent(/only socks5 is supported/i);
  });

  it('selecting SOCKS5 hides the warning', () => {
    renderProxy({ ...base, proxy: { enabled: true, kind: 'socks5', host: 'p', port: 1080 } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('typing a username reveals the password field', () => {
    renderProxy({ ...base, proxy: { enabled: true, kind: 'socks5', host: 'p', port: 1080, auth: { username: 'u' } } });
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });
});
