import { useState } from 'react';

interface Props {
  initialName?: string;
  initialTags?: string;
  onSave: (name: string, tags: string) => Promise<void>;
  onCancel: () => void;
}

export function SaveScriptDialog({ initialName = '', initialTags = '', onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [tags, setTags] = useState(initialTags);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave(name.trim(), tags);
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Save Script"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6,
          padding: 20, width: 360,
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>Save Script</h3>
        <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>Name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
        <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>Tags (comma-separated)</div>
        <input value={tags} onChange={(e) => setTags(e.target.value)} style={{ width: '100%' }} />
        {err && <div style={{ color: 'var(--accent-red)', marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
