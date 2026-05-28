import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServerTab } from '../ServerTab';
import type { Connection } from '../../../../../../connection/model';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../../connection/overrides';

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

  it('switching target kind to URI prompts before wiping fields', () => {
    const onChange = vi.fn();
    window.confirm = vi.fn(() => true);
    render(<ServerTab value={direct} onChange={onChange} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/connection uri/i));
    expect(window.confirm).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ ...direct, target: { kind: 'uri', uri: '' } });
  });

  it('renders URI input for kind=uri', () => {
    const uri: Connection = { ...direct, target: { kind: 'uri', uri: 'mongodb://x' } };
    render(<ServerTab value={uri} onChange={() => {}} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
    expect(screen.getByLabelText(/connection uri/i)).toBeChecked();
    expect(screen.getByDisplayValue('mongodb://x')).toBeInTheDocument();
  });
});
