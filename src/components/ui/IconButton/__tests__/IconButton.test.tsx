import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IconButton } from '../IconButton';

describe('IconButton', () => {
  it('renders icon and exposes aria-label', () => {
    render(<IconButton aria-label="Close" icon={<span data-testid="x">x</span>} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByTestId('x')).toBeInTheDocument();
  });

  it('fires click handler', () => {
    const onClick = vi.fn();
    render(<IconButton aria-label="Refresh" icon="↻" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('reflects pressed state via aria-pressed', () => {
    render(<IconButton aria-label="Toggle" icon="*" pressed />);
    expect(screen.getByRole('button', { name: 'Toggle' })).toHaveAttribute('aria-pressed', 'true');
  });
});
