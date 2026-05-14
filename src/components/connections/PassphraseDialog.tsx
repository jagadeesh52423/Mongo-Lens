import { useState } from 'react';

interface PassphraseDialogProps {
  /** Connection name shown in the dialog title. */
  connectionName: string;
  onConfirm: (passphrase: string) => void;
  onCancel: () => void;
}

/**
 * Prompts the user for the SSH private-key passphrase.
 * Shown when `connect_connection` returns `PassphraseRequired`.
 */
export function PassphraseDialog({ connectionName, onConfirm, onCancel }: PassphraseDialogProps) {
  const [passphrase, setPassphrase] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(passphrase);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 24, width: 360,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>SSH Key Passphrase</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-dim)' }}>
          The SSH key for <strong>{connectionName}</strong> is encrypted.
          Enter the passphrase to continue.
        </p>
        <input
          type="password"
          autoFocus
          placeholder="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!passphrase}>Connect</button>
        </div>
      </form>
    </div>
  );
}
