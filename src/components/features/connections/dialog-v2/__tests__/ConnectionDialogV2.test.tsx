import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionDialogV2 } from '../ConnectionDialogV2';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../connection/overrides';
import type { Connection } from '../../../../../connection/model';

const sample: Connection = {
  id: 'a', name: 'My Cluster', color: '#10b981',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ConnectionDialogV2', () => {
  it('renders name + color picker + Server tab content for existing connection', () => {
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/connection name/i)).toHaveValue('My Cluster');
    expect(screen.getByRole('tab', { name: /server/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/host/i)).toHaveValue('h');
  });

  it('Cancel without dirty changes invokes onCancel immediately', () => {
    const onCancel = vi.fn();
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Save invokes onSave with {connection, secrets}', () => {
    const onSave = vi.fn().mockResolvedValue(sample);
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith({ connection: sample, secrets: [] });
  });

  it('Save is disabled when host is empty (validation error)', () => {
    const blank: Connection = { ...sample, target: { kind: 'direct', host: '', port: 27017 } };
    render(<ConnectionDialogV2 initial={blank} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/issue/i)).toBeInTheDocument();
  });
});
