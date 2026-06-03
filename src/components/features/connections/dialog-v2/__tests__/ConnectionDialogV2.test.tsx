import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { ConnectionDialogV2 } from '../ConnectionDialogV2';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../connection/overrides';
import { BLANK_SSH, BLANK_PROXY } from '../../../../../connection/feature-state';
import type { Connection } from '../../../../../connection/model';

const sample: Connection = {
  id: 'a', name: 'My Cluster', color: '#10b981',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ConnectionDialogV2', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

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

  it('drops blank disabled SSH/proxy/tls from the saved connection', () => {
    const onSave = vi.fn().mockResolvedValue(sample);
    const draft: Connection = {
      ...sample,
      tls: { enabled: false },
      ssh: BLANK_SSH,
      proxy: BLANK_PROXY,
    };
    render(<ConnectionDialogV2 initial={draft} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const saved = onSave.mock.calls[0][0].connection as Connection;
    expect(saved.tls).toBeUndefined();
    expect(saved.ssh).toBeUndefined();
    expect(saved.proxy).toBeUndefined();
  });

  it('Save is disabled when host is empty (validation error)', () => {
    const blank: Connection = { ...sample, target: { kind: 'direct', host: '', port: 27017 } };
    render(<ConnectionDialogV2 initial={blank} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/issue/i)).toBeInTheDocument();
  });

  it('Test button calls connections_v2_test with current draft + secrets', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true, serverInfo: {} });
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    });
    expect(invoke).toHaveBeenCalledWith('connections_v2_test', {
      input: { connection: sample, secrets: [] },
    });
  });

  it('renders "SSH tunnel failed" heading when test result stage is ssh', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: false, stage: 'ssh', error: 'no route to host' });
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    });
    await waitFor(() => expect(screen.getByText(/SSH tunnel failed/i)).toBeInTheDocument());
    expect(screen.getByText(/no route to host/i)).toBeInTheDocument();
  });

  it('renders "✓ Connection OK" when test result is ok', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true, serverInfo: { version: '7.0' } });
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    });
    await waitFor(() => expect(screen.getByText(/Connection OK/i)).toBeInTheDocument());
  });

  it('Test button is disabled while there are validation issues', () => {
    const blank: Connection = { ...sample, target: { kind: 'direct', host: '', port: 27017 } };
    render(<ConnectionDialogV2 initial={blank} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
  });
});
