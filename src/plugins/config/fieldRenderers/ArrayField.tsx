import { useState, ReactNode } from 'react';
import type { FieldRenderer } from './index';
import { defaultFieldRendererRegistry, FieldRendererRegistry } from './index';
import type { JSONSchemaProperty } from '../../manifest';

interface ArrayProps {
  schema: JSONSchemaProperty;
  value: unknown;
  onCommit: (v: unknown[]) => void;
  _registry?: FieldRendererRegistry;
}

export const arrayField: FieldRenderer = {
  matches: (s) => s.type === 'array',
  render: (props) => <ArrayBody {...(props as unknown as ArrayProps)} />,
};

function ArrayBody(p: ArrayProps): ReactNode {
  const initial = Array.isArray(p.value) ? p.value : [];
  const [items, setItems] = useState<unknown[]>(initial);
  const childRegistry = p._registry ?? defaultFieldRendererRegistry;
  const itemSchema = p.schema.items;
  if (!itemSchema) return <em>(invalid array schema: missing items)</em>;
  const child = childRegistry.find(itemSchema);
  if (!child) return <em>(no renderer for item type {itemSchema.type})</em>;

  const set = (next: unknown[]) => { setItems(next); p.onCommit(next); };
  const setOne = (i: number, v: unknown) => {
    const next = items.slice(); next[i] = v; set(next);
  };
  const removeAt = (i: number) => {
    const next = items.slice(); next.splice(i, 1); set(next);
  };
  const add = () => set([...items, defaultFor(itemSchema)]);

  return (
    <div className="array-field">
      {items.map((v, i) => (
        <div key={i} className="array-row">
          {child.render({ schema: itemSchema, value: v, onCommit: (nv) => setOne(i, nv) })}
          <button type="button" onClick={() => removeAt(i)}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={add}>Add</button>
    </div>
  );
}

function defaultFor(s: JSONSchemaProperty): unknown {
  if (s.default !== undefined) return s.default;
  switch (s.type) {
    case 'string':  return '';
    case 'integer':
    case 'number':  return 0;
    case 'boolean': return false;
    case 'array':   return [];
    case 'object':  return {};
  }
}
