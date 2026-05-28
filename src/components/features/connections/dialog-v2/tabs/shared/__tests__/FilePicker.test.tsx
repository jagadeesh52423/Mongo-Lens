import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

import { open } from '@tauri-apps/plugin-dialog';
import { FilePicker } from '../FilePicker';

describe('FilePicker', () => {
  it('Browse populates value from open() result', async () => {
    vi.mocked(open).mockResolvedValueOnce('/etc/ssl/ca.pem');
    const onChange = vi.fn();
    render(<FilePicker id="x" label="CA file" value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/etc/ssl/ca.pem'));
  });

  it('typing into the input forwards the value (or undefined when empty)', () => {
    const onChange = vi.fn();
    render(<FilePicker id="x" label="CA file" value="/old" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/ca file/i), { target: { value: '/new/path' } });
    expect(onChange).toHaveBeenLastCalledWith('/new/path');
    fireEvent.change(screen.getByLabelText(/ca file/i), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
