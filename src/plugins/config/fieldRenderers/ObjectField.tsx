import { ReactNode } from 'react';
import type { FieldRenderer } from './index';
import { defaultFieldRendererRegistry, FieldRendererRegistry } from './index';
import type { JSONSchemaProperty } from '../../manifest';

interface ObjectProps {
  schema: JSONSchemaProperty;
  value: unknown;
  onCommit: (v: Record<string, unknown>) => void;
  _registry?: FieldRendererRegistry;
}

export const objectField: FieldRenderer = {
  matches: (s) => s.type === 'object',
  render: (props) => <ObjectBody {...(props as unknown as ObjectProps)} />,
};

function ObjectBody(p: ObjectProps): ReactNode {
  const reg = p._registry ?? defaultFieldRendererRegistry;
  const v = (p.value && typeof p.value === 'object') ? p.value as Record<string, unknown> : {};
  const props = p.schema.properties ?? {};
  return (
    <details open className="object-field">
      <summary>{p.schema.title ?? '(object)'}</summary>
      {Object.entries(props).map(([k, childSchema]) => {
        const child = reg.find(childSchema);
        if (!child) return <div key={k}><em>(no renderer for {k})</em></div>;
        return (
          <div key={k} className="object-row">
            <label>{childSchema.title ?? k}</label>
            {child.render({
              schema: childSchema,
              value: v[k],
              onCommit: (cv) => p.onCommit({ ...v, [k]: cv }),
            })}
          </div>
        );
      })}
    </details>
  );
}
