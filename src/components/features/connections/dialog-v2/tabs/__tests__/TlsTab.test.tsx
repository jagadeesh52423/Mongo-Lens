import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { TlsTab } from '../TlsTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

const base: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

function renderTls(value: Connection, onChange = vi.fn()) {
  render(
    <TlsTab
      value={value}
      onChange={onChange}
      globals={DEFAULT_GLOBAL_PREFS}
      secrets={{}}
      onSecretChange={() => {}}
    />,
  );
  return { onChange };
}

describe('TlsTab', () => {
  it('shows cert fields even when TLS is disabled', () => {
    renderTls({ ...base, tls: { enabled: false } });
    expect(screen.getByLabelText(/ca certificate/i)).toBeInTheDocument();
  });

  it('defaults to disabled when no tls present (renders fields, toggle off)', () => {
    renderTls({ ...base });
    expect(screen.getByLabelText(/enable tls/i)).not.toBeChecked();
    expect(screen.getByLabelText(/ca certificate/i)).toBeInTheDocument();
  });

  it('toggling enable preserves existing field data', () => {
    const { onChange } = renderTls({ ...base, tls: { enabled: false, caFile: '/ca.pem' } as Connection['tls'] });
    fireEvent.click(screen.getByLabelText(/enable tls/i));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      tls: expect.objectContaining({ enabled: true, caFile: '/ca.pem' }),
    }));
  });

  it('renders CA + client cert pickers when TLS is enabled', () => {
    renderTls({ ...base, tls: { enabled: true } });
    expect(screen.getByLabelText(/ca certificate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client certificate/i)).toBeInTheDocument();
  });

  it('shows the insecure warning banner when allowInvalidCerts is on', () => {
    renderTls({ ...base, tls: { enabled: true, allowInvalidCerts: true } });
    expect(screen.getByRole('alert')).toHaveTextContent(/server certificate validation is disabled/i);
  });
});
