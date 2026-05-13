import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { secretField } from '../plugins/config/fieldRenderers';

describe('SecretField', () => {
  it('matches string + x-secret:true', () => {
    expect(secretField.matches({ type: 'string', 'x-secret': true })).toBe(true);
    expect(secretField.matches({ type: 'string' })).toBe(false);
  });

  it('renders type="password" by default', () => {
    render(<>{secretField.render({
      schema: { type: 'string', 'x-secret': true },
      value: 'pw', onCommit: () => {},
    })}</>);
    const input = screen.getByLabelText(/secret value/i) as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('reveal toggle switches to text and back', () => {
    render(<>{secretField.render({
      schema: { type: 'string', 'x-secret': true },
      value: 'pw', onCommit: () => {},
    })}</>);
    const input = screen.getByLabelText(/secret value/i) as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: /show|reveal/i });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    fireEvent.click(toggle);
    expect(input.type).toBe('password');
  });

  it('commits on blur', () => {
    const onCommit = vi.fn();
    render(<>{secretField.render({
      schema: { type: 'string', 'x-secret': true },
      value: '', onCommit,
    })}</>);
    const input = screen.getByLabelText(/secret value/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'newpw' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('newpw');
  });
});
