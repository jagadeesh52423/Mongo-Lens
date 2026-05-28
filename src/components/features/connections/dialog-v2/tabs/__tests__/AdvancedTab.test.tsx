import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedTab, hasAdvancedOverrides } from '../AdvancedTab';
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
    <AdvancedTab
      value={value}
      onChange={onChange}
      globals={DEFAULT_GLOBAL_PREFS}
      secrets={{}}
      onSecretChange={() => {}}
    />,
  );
  return { onChange };
}

describe('AdvancedTab', () => {
  it('shows compressor "Use global" hint listing global selections', () => {
    renderTab(base);
    expect(screen.getByText(/use global: snappy/i)).toBeInTheDocument();
  });

  it('toggling a compressor checkbox patches overrides.advanced.compressors', () => {
    const { onChange } = renderTab(base);
    // Globally snappy is on; click zstd to add it as an override.
    fireEvent.click(screen.getByLabelText(/zstd/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { advanced: { compressors: ['snappy', 'zstd'] } },
      }),
    );
  });

  it('Reset on compressors clears them back to undefined', () => {
    const { onChange } = renderTab({
      ...base,
      overrides: { advanced: { compressors: ['zstd'] } },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: { advanced: { compressors: undefined } },
      }),
    );
  });

  it('hasAdvancedOverrides reflects override presence', () => {
    expect(hasAdvancedOverrides({})).toBe(false);
    expect(hasAdvancedOverrides({ overrides: { advanced: { retryWrites: false } } })).toBe(true);
  });
});
