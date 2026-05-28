import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OverrideRow } from '../OverrideRow';

describe('OverrideRow', () => {
  it('shows "Use global: <value>" placeholder when override is undefined', () => {
    render(<OverrideRow label="Command timeout (ms)" globalValue={30000} value={undefined} onChange={() => {}} type="number" />);
    expect(screen.getByPlaceholderText(/use global: 30000/i)).toBeInTheDocument();
  });

  it('renders the override value when set', () => {
    render(<OverrideRow label="Command timeout (ms)" globalValue={30000} value={5000} onChange={() => {}} type="number" />);
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument();
  });

  it('Reset button clears the override (sets undefined)', () => {
    const onChange = vi.fn();
    render(<OverrideRow label="Command timeout (ms)" globalValue={30000} value={5000} onChange={onChange} type="number" />);
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('false ≠ undefined for boolean fields (no "Use global" hint when explicitly overridden to false)', () => {
    const onChange = vi.fn();
    render(<OverrideRow label="Auto-complete" globalValue={true} value={false} onChange={onChange} type="boolean" />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.queryByText(/use global/i)).toBeNull();
    // Reset button is visible only when overridden.
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });
});
