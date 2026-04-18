import { useState, useEffect } from 'react';
import { updateDocument } from '../../ipc';

interface RecordModalProps {
  doc: Record<string, unknown>;
  initialMode: 'view' | 'edit';
  connectionId: string;
  database: string;
  collection: string;
  onClose: () => void;
  onSaved: () => void;
}

export function RecordModal({
  doc,
  initialMode,
  connectionId,
  database,
  collection,
  onClose,
  onSaved,
}: RecordModalProps) {
  const { _id, ...rest } = doc;
  const idStr = String(_id ?? '');
  const originalJson = JSON.stringify(rest, null, 2);

  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [editedJson, setEditedJson] = useState(originalJson);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editedJson);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (JSON.stringify(parsed) === JSON.stringify(rest)) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDocument(connectionId, database, collection, idStr, JSON.stringify(parsed));
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (initialMode === 'edit') {
      onClose();
    } else {
      setMode('view');
      setEditedJson(originalJson);
      setError(null);
    }
  }

  function switchToEdit() {
    setEditedJson(originalJson);
    setMode('edit');
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'view' ? 'Full Record' : 'Edit Record'}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          width: 600,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span
            style={{
              fontWeight: 600,
              color: mode === 'edit' ? 'var(--accent-orange, #ed8936)' : 'var(--fg)',
            }}
          >
            {mode === 'view' ? 'Full Record' : 'Edit Record'}
          </span>
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div
          style={{
            background: 'var(--bg-row-alt, #2d3748)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 10px',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--fg-dim)', textTransform: 'uppercase', fontSize: 10, letterSpacing: 1 }}>_id</span>
          <span style={{ color: 'var(--accent-yellow, #fbd38d)' }}>{idStr}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--fg-dim)', fontSize: 10 }}>read-only</span>
        </div>

        {mode === 'view' ? (
          <pre
            style={{
              flex: 1, overflow: 'auto', margin: 0,
              background: 'var(--bg-code, #0d1117)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 10,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--fg)',
              minHeight: 200,
            }}
          >
            {originalJson}
          </pre>
        ) : (
          <textarea
            style={{
              flex: 1, resize: 'none',
              background: 'var(--bg-code, #0d1117)',
              border: `1px solid ${error ? 'var(--accent-red, #fc8181)' : 'var(--accent-blue, #63b3ed)'}`,
              borderRadius: 4,
              padding: 10,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--fg)',
              minHeight: 200,
            }}
            value={editedJson}
            onChange={(e) => { setEditedJson(e.target.value); setError(null); }}
            spellCheck={false}
          />
        )}

        {error && (
          <div
            style={{
              background: 'var(--accent-red-dim, #742a2a)',
              border: '1px solid var(--accent-red, #fc8181)',
              borderRadius: 4,
              padding: '4px 8px',
              color: 'var(--accent-red, #fc8181)',
              fontSize: 12,
            }}
          >
            ✕ {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {mode === 'view' ? (
            <>
              <button onClick={onClose}>Close</button>
              <button onClick={switchToEdit}>Edit (F4)</button>
            </>
          ) : (
            <>
              <span style={{ marginRight: 'auto', color: 'var(--fg-dim)', fontSize: 11 }}>
                No changes → submit is a no-op
              </span>
              <button onClick={handleCancel} disabled={saving}>Cancel</button>
              <button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : 'Submit'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
