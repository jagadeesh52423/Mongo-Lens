import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordField } from '../components/ui/PasswordField';

describe('PasswordField', () => {
  it('renders as type="password" by default', () => {
    render(<PasswordField aria-label="Password" />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('toggle button reveals the value (switches to type="text")', () => {
    render(<PasswordField aria-label="Password" defaultValue="secret" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(input).toHaveAttribute('type', 'text');
  });

  it('toggle button hides the value again on second click', () => {
    render(<PasswordField aria-label="Password" defaultValue="secret" />);
    const toggle = screen.getByRole('button', { name: /show/i });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('forwards extra props (placeholder, onChange) to the input', () => {
    const onChange = vi.fn();
    render(<PasswordField aria-label="Password" placeholder="Enter password" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Enter password');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('applies disabled state to both input and toggle button', () => {
    render(<PasswordField aria-label="Password" disabled />);
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: /show/i })).toBeDisabled();
  });
});
