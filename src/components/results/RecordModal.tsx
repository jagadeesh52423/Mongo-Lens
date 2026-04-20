import { useState, useEffect, useRef } from 'react';
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
  const idStr = String(doc._id ?? '');
  const { _id: _removed, ...docWithoutId } = doc;
  const originalJson = JSON.stringify(docWithoutId, null, 2);

  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [editedJson, setEditedJson] = useState(originalJson);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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
    if ('_id' in parsed && String(parsed._id) !== idStr) {
      setError(`_id cannot be changed. Original: ${idStr}`);
      return;
    }
    const { _id: _drop, ...parsedWithoutId } = parsed;
    if (JSON.stringify(parsedWithoutId) === JSON.stringify(docWithoutId)) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDocument(connectionId, database, collection, idStr, JSON.stringify(parsedWithoutId));
      onSaved();
      onClose();
    } catch (e) {
      console.error('[RecordModal] updateDocument failed:', e);
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
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
        if (e.key === 'F4' && mode === 'view') switchToEdit();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'view' ? 'Full Record' : 'Edit Record'}
        tabIndex={-1}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          width: 600,
          maxWidth: '90vw',
          height: '80vh',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 12,
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontWeight: 600,
                color: mode === 'edit' ? 'var(--accent-orange, #ed8936)' : 'var(--fg)',
              }}
            >
              {mode === 'view' ? 'Full Record' : 'Edit Record'}
            </span>
            {idStr && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--fg-dim)',
                  background: 'var(--bg-rail)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '1px 6px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {idStr}
              </span>
            )}
          </span>
          <button aria-label="Close" onClick={onClose}>✕</button>
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
