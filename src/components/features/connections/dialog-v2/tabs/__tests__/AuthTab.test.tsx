import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthTab } from '../AuthTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

const baseScram: Connection = {
  id: 'a',
  name: 'X',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'scram', username: 'u', authDb: 'admin', mechanism: 'auto' },
  createdAt: '2026-01-01T00:00:00Z',
};

const baseNone: Connection = { ...baseScram, auth: { kind: 'none' } };

function renderAuthTab(
  value: Connection,
  secrets: Record<string, string> = {},
  onChange = vi.fn(),
  onSecretChange = vi.fn(),
  onAuthKindChange = vi.fn(),
) {
  render(
    <AuthTab
      value={value}
      onChange={onChange}
      globals={DEFAULT_GLOBAL_PREFS}
      secrets={secrets}
      onSecretChange={onSecretChange}
      onAuthKindChange={onAuthKindChange}
    />,
  );
  return { onChange, onSecretChange, onAuthKindChange };
}

describe('AuthTab', () => {
  it('renders ScramForm when auth.kind=scram', () => {
    renderAuthTab(baseScram);
    expect(screen.getByLabelText(/username/i)).toHaveValue('u');
    expect(screen.getByLabelText(/auth db/i)).toHaveValue('admin');
    expect(screen.getByLabelText(/mechanism/i)).toBeInTheDocument();
  });

  it('renders NoneForm when auth.kind=none', () => {
    renderAuthTab(baseNone);
    expect(screen.getByText(/no authentication will be attempted/i)).toBeInTheDocument();
  });

  it('switching mode dispatches onAuthKindChange with the new kind', () => {
    const { onAuthKindChange, onChange } = renderAuthTab(baseScram);
    fireEvent.change(screen.getByLabelText(/authentication mode/i), { target: { value: 'x509' } });
    // The reducer owns blank-variant logic via set-auth-kind; AuthTab only signals the kind.
    expect(onAuthKindChange).toHaveBeenCalledWith('x509');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('password field renders masked by default (no keychain placeholder)', () => {
    renderAuthTab(baseScram, {});
    const input = screen.getByLabelText(/^password$/i);
    expect(input).toHaveAttribute('type', 'password');
    expect(input).not.toHaveAttribute('placeholder', expect.stringMatching(/keychain/i));
  });
});
