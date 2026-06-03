import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServerTab } from '../ServerTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

/** Controlled wrapper so target changes flow back into the component (mirrors
 *  the dialog reducer), letting us exercise switch-and-restore behavior. */
function Harness({ initial }: { initial: Connection }) {
  const [val, setVal] = useState(initial);
  return (
    <ServerTab value={val} onChange={setVal} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />
  );
}

const direct: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'db.example', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ServerTab', () => {
  it('renders host and port for kind=direct', () => {
    render(<ServerTab value={direct} onChange={() => {}} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    expect(screen.getByLabelText(/host/i)).toHaveValue('db.example');
    expect(screen.getByLabelText(/port/i)).toHaveValue(27017);
  });

  it('updates host via onChange', () => {
    const onChange = vi.fn();
    render(<ServerTab value={direct} onChange={onChange} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'other.host' } });
    expect(onChange).toHaveBeenCalledWith({
      ...direct,
      target: { kind: 'direct', host: 'other.host', port: 27017 },
    });
  });

  it('switches to URI mode without a discard prompt', () => {
    const onChange = vi.fn();
    window.confirm = vi.fn(() => true);
    render(<ServerTab value={direct} onChange={onChange} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: /connection uri/i }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ ...direct, target: { kind: 'uri', uri: '' } });
  });

  it('preserves and restores each mode when switching back and forth', () => {
    render(<Harness initial={direct} />);
    // Edit the direct host, then switch to URI and type a URI
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'myhost' } });
    fireEvent.click(screen.getByRole('radio', { name: /connection uri/i }));
    fireEvent.change(screen.getByLabelText(/uri/i), { target: { value: 'mongodb://x' } });
    // Switch back to Direct → host restored, not wiped
    fireEvent.click(screen.getByRole('radio', { name: /^direct$/i }));
    expect(screen.getByLabelText(/host/i)).toHaveValue('myhost');
    expect(screen.getByLabelText(/port/i)).toHaveValue(27017);
    // Switch to URI again → URI restored
    fireEvent.click(screen.getByRole('radio', { name: /connection uri/i }));
    expect(screen.getByLabelText(/uri/i)).toHaveValue('mongodb://x');
  });

  it('renders URI input for kind=uri', () => {
    const uri: Connection = { ...direct, target: { kind: 'uri', uri: 'mongodb://x' } };
    render(<ServerTab value={uri} onChange={() => {}} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /connection uri/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByDisplayValue('mongodb://x')).toBeInTheDocument();
  });
});
