import { useState, useEffect } from 'react';
import type { FieldRenderer } from './index';

export const secretField: FieldRenderer = {
  matches: (s) => s.type === 'string' && s['x-secret'] === true,
  render: ({ value, error, onCommit, id }) => (
    <SecretInput id={id} value={value as string | undefined} onCommit={onCommit} error={error} />
  ),
};

function SecretInput(p: { id?: string; value: string | undefined; onCommit: (v: string) => void; error?: string }) {
  const [local, setLocal] = useState(p.value ?? '');
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setLocal(p.value ?? ''); }, [p.value]);
  return (
    <span>
      <input
        id={p.id}
        type={revealed ? 'text' : 'password'}
        aria-label="Secret value"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => p.onCommit(local)}
      />
      <button type="button" onClick={() => setRevealed(r => !r)}
              aria-label={revealed ? 'Hide secret' : 'Reveal secret'}>
        {revealed ? 'Hide' : 'Show'}
      </button>
      {p.error && <small className="field-error">{p.error}</small>}
    </span>
  );
}
