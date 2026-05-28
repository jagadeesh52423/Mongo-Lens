import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IntelliShellTab, hasIntelliShellOverrides } from '../IntelliShellTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

const base: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

function renderTab(value: Connection, onChange = vi.fn()) {
  render(
    <IntelliShellTab
      value={value}
      onChange={onChange}
      globals={DEFAULT_GLOBAL_PREFS}
      secrets={{}}
      onSecretChange={() => {}}
    />,
  );
  return { onChange };
}

describe('IntelliShellTab', () => {
  it('renders "Use global: <value>" placeholders when no overrides are set', () => {
    renderTab(base);
    expect(screen.getByPlaceholderText(/use global: 30000/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/use global: 1000/i)).toBeInTheDocument();
  });

  it('setting an override patches connection.overrides.intelliShell', () => {
    const { onChange } = renderTab(base);
    fireEvent.change(screen.getByLabelText(/command timeout/i), { target: { value: '5000' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { intelliShell: { commandTimeoutMs: 5000 } },
      }),
    );
  });

  it('Reset clears the override (sets undefined)', () => {
    const { onChange } = renderTab({
      ...base,
      overrides: { intelliShell: { commandTimeoutMs: 5000 } },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { intelliShell: { commandTimeoutMs: undefined } },
      }),
    );
  });

  it('hasIntelliShellOverrides returns true only when at least one field is set', () => {
    expect(hasIntelliShellOverrides({})).toBe(false);
    expect(hasIntelliShellOverrides({ overrides: { intelliShell: {} } })).toBe(false);
    expect(hasIntelliShellOverrides({ overrides: { intelliShell: { commandTimeoutMs: 5000 } } })).toBe(true);
    // false is a legitimate override (not undefined)
    expect(hasIntelliShellOverrides({ overrides: { intelliShell: { autoCompleteEnabled: false } } })).toBe(true);
  });
});
