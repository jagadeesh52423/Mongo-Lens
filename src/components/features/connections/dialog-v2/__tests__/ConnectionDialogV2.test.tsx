import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';


vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { ConnectionDialogV2, pruneSecrets } from '../ConnectionDialogV2';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../connection/overrides';
import { BLANK_SSH, BLANK_PROXY } from '../../../../../connection/feature-state';
import type { Connection } from '../../../../../connection/model';
import type { SecretInput } from '../../../../../connection/ipc';

const sample: Connection = {
  id: 'a', name: 'My Cluster', color: '#10b981',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ConnectionDialogV2', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    // Default: getSecretsV2 returns empty map; tests that care use mockResolvedValueOnce
    vi.mocked(invoke).mockResolvedValue({});
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

  it('Save invokes onSave with {connection, secrets}', async () => {
    const onSave = vi.fn().mockResolvedValue(sample);
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
    expect(onSave).toHaveBeenCalledWith({ connection: sample, secrets: [] });
  });

  it('drops blank disabled SSH/proxy/tls from the saved connection', async () => {
    const onSave = vi.fn().mockResolvedValue(sample);
    const draft: Connection = {
      ...sample,
      tls: { enabled: false },
      ssh: BLANK_SSH,
      proxy: BLANK_PROXY,
    };
    render(<ConnectionDialogV2 initial={draft} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
    const saved = onSave.mock.calls[0][0].connection as Connection;
    expect(saved.tls).toBeUndefined();
    expect(saved.ssh).toBeUndefined();
    expect(saved.proxy).toBeUndefined();
  });

  it('prunes the ssh-password secret when SSH is dropped as blank-disabled on save', async () => {
    const onSave = vi.fn().mockResolvedValue(sample);
    const draft: Connection = { ...sample, ssh: BLANK_SSH };
    render(<ConnectionDialogV2 initial={draft} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /ssh/i }));
    fireEvent.change(screen.getByLabelText(/ssh password/i), { target: { value: 'hunter2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
    const input = onSave.mock.calls[0][0];
    expect(input.connection.ssh).toBeUndefined();
    expect(input.secrets.find((s: SecretInput) => s.slot === 'ssh-password')).toBeUndefined();
  });

  it('pruneSecrets drops a feature\'s secrets when that feature is absent, keeps the rest', () => {
    const secrets: SecretInput[] = [
      { slot: 'auth-password', value: 'a' },
      { slot: 'ssh-password', value: 's' },
      { slot: 'ssh-key-passphrase', value: 'k' },
      { slot: 'proxy-password', value: 'p' },
    ];
    // No ssh, no proxy on the connection → both feature's secrets pruned.
    const dropped = pruneSecrets(secrets, { ...sample });
    expect(dropped.map((s) => s.slot)).toEqual(['auth-password']);

    // Proxy present → proxy-password kept; ssh still absent → ssh slots pruned.
    const withProxy: Connection = { ...sample, proxy: { ...BLANK_PROXY, enabled: true, host: '10.0.0.1' } };
    const kept = pruneSecrets(secrets, withProxy);
    expect(kept.map((s) => s.slot).sort()).toEqual(['auth-password', 'proxy-password']);
  });

  it('Save is disabled when host is empty (validation error)', () => {
    const blank: Connection = { ...sample, target: { kind: 'direct', host: '', port: 27017 } };
    render(<ConnectionDialogV2 initial={blank} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/issue/i)).toBeInTheDocument();
  });

  it('Test button calls connections_v2_test with current draft + secrets', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({})                    // connections_v2_get_secrets (useEffect)
      .mockResolvedValueOnce({ ok: true, serverInfo: {} }); // connections_v2_test (click)
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    });
    expect(invoke).toHaveBeenCalledWith('connections_v2_test', {
      input: { connection: sample, secrets: [] },
    });
  });

  it('renders "SSH tunnel failed" heading when test result stage is ssh', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({})                                              // connections_v2_get_secrets (useEffect)
      .mockResolvedValueOnce({ ok: false, stage: 'ssh', error: 'no route to host' }); // connections_v2_test (click)
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    });
    await waitFor(() => expect(screen.getByText(/SSH tunnel failed/i)).toBeInTheDocument());
    expect(screen.getByText(/no route to host/i)).toBeInTheDocument();
  });

  it('renders "✓ Connection OK" when test result is ok', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({})                                             // connections_v2_get_secrets (useEffect)
      .mockResolvedValueOnce({ ok: true, serverInfo: { version: '7.0' } }); // connections_v2_test (click)
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

  // ── Save-error surfacing (spec: advisor-approved async handleSave) ──────────

  it('onSave rejecting renders "Save failed" in footer; dialog stays open, onCancel not called', async () => {
    const onCancel = vi.fn();
    const onSave = vi.fn().mockRejectedValue(
      new Error("failed to store secret 'auth-password': stored secret unavailable: the encryption key is missing"),
    );
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={onCancel} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    await waitFor(() => expect(screen.getByText(/Save failed/i)).toBeInTheDocument());
    expect(screen.getByText(/encryption key is missing/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('onSave resolving → no error shown; onSave called with normalized input', async () => {
    const onSave = vi.fn().mockResolvedValue(sample);
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    expect(onSave).toHaveBeenCalledWith({ connection: sample, secrets: [] });
    expect(screen.queryByText(/Save failed/i)).not.toBeInTheDocument();
  });

  it('Save button is disabled while save is in-flight, preventing double-submit', async () => {
    let resolveOnSave!: (v: Connection) => void;
    const onSave = vi.fn().mockImplementation(
      () => new Promise<Connection>((res) => { resolveOnSave = res; }),
    );
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);

    // First click — kicks off the async save; act flushes the setSaving(true) state update
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();

    // Second click on a disabled button must not fire onSave again
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledTimes(1);

    // Resolve the pending promise — button re-enables
    await act(async () => { resolveOnSave(sample); });
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });

  it('saveError clears when the user edits a field after a failed save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('key missing'));
    render(<ConnectionDialogV2 initial={sample} globals={DEFAULT_GLOBAL_PREFS} onSave={onSave} onCancel={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    await waitFor(() => expect(screen.getByText(/Save failed/i)).toBeInTheDocument());

    // Editing the name field must clear the error
    fireEvent.change(screen.getByLabelText(/connection name/i), { target: { value: 'Renamed' } });
    expect(screen.queryByText(/Save failed/i)).not.toBeInTheDocument();
  });
});
