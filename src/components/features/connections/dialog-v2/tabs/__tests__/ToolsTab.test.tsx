import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { ToolsTab, hasToolsOverrides } from '../ToolsTab';
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
    <ToolsTab
      value={value}
      onChange={onChange}
      globals={DEFAULT_GLOBAL_PREFS}
      secrets={{}}
      onSecretChange={() => {}}
    />,
  );
  return { onChange };
}

describe('ToolsTab', () => {
  it('shows "Use global: <path>" hint per row when no overrides are set', () => {
    renderTab(base);
    expect(screen.getByText(/use global: \/usr\/bin\/mongodump/i)).toBeInTheDocument();
    expect(screen.getByText(/use global: \/usr\/bin\/mongorestore/i)).toBeInTheDocument();
  });

  it('typing a path patches connection.overrides.tools', () => {
    const { onChange } = renderTab(base);
    fireEvent.change(screen.getByLabelText(/mongodump path/i), { target: { value: '/opt/mongo/bin/mongodump' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { tools: { mongodumpPath: '/opt/mongo/bin/mongodump' } },
      }),
    );
  });

  it('Reset clears that field back to undefined', () => {
    const { onChange } = renderTab({
      ...base,
      overrides: { tools: { mongodumpPath: '/custom/mongodump' } },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { tools: { mongodumpPath: undefined } },
      }),
    );
  });

  it('hasToolsOverrides reflects override presence', () => {
    expect(hasToolsOverrides({})).toBe(false);
    expect(hasToolsOverrides({ overrides: { tools: { mongodumpPath: '/x' } } })).toBe(true);
  });
});
