import { useState } from 'react';
import type { FieldRenderer, FieldRendererProps } from './index';

export const stringField: FieldRenderer = {
  matches: (s) => s.type === 'string' && s['x-secret'] !== true,
  render: ({ schema, value, error, onCommit, id }) => {
    if (schema.enum) {
      return (
        <span>
          <select
            id={id}
            value={(value as string | undefined) ?? ''}
            onChange={(e) => onCommit(e.target.value)}
          >
            {schema.enum.map((opt) => (
              <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
            ))}
          </select>
          {error && <small className="field-error">{error}</small>}
        </span>
      );
    }
    return <StringInput id={id} value={value as string | undefined} onCommit={onCommit} error={error} />;
  },
};

function StringInput(p: Pick<FieldRendererProps, 'id' | 'error'> & { value: string | undefined; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(p.value ?? '');
  return (
    <span>
      <input
        id={p.id}
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => p.onCommit(local)}
      />
      {p.error && <small className="field-error">{p.error}</small>}
    </span>
  );
}
