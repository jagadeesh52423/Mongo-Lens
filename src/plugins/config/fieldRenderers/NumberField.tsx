import { useState } from 'react';
import type { FieldRenderer, FieldRendererProps } from './index';

export const numberField: FieldRenderer = {
  matches: (s) => s.type === 'number' || s.type === 'integer',
  render: ({ schema, value, error, onCommit, id }) => (
    <NumberInput
      id={id}
      value={value as number | undefined}
      integer={schema.type === 'integer'}
      onCommit={onCommit}
      error={error}
      min={schema.minimum}
      max={schema.maximum}
    />
  ),
};

function NumberInput(p: Pick<FieldRendererProps, 'id' | 'error'> & {
  value: number | undefined; integer: boolean; onCommit: (v: number) => void;
  min?: number; max?: number;
}) {
  const [local, setLocal] = useState(p.value === undefined ? '' : String(p.value));
  return (
    <span>
      <input
        id={p.id}
        type="number"
        value={local}
        min={p.min}
        max={p.max}
        step={p.integer ? 1 : 'any'}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = p.integer ? parseInt(local, 10) : parseFloat(local);
          if (!Number.isNaN(n)) p.onCommit(n);
        }}
      />
      {p.error && <small className="field-error">{p.error}</small>}
    </span>
  );
}
