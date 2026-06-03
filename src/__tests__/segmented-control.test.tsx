import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../components/ui/SegmentedControl';

const opts = [
  { value: 'direct', label: 'Direct' },
  { value: 'uri', label: 'Connection URI' },
] as const;

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio per option', () => {
    render(<SegmentedControl ariaLabel="Target type" value="direct" options={opts as any} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Target type' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('marks the active option aria-checked', () => {
    render(<SegmentedControl ariaLabel="Target type" value="uri" options={opts as any} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Connection URI' })).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onChange with the option value when clicked', () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Target type" value="direct" options={opts as any} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Connection URI' }));
    expect(onChange).toHaveBeenCalledWith('uri');
  });
});
