import { useState, useMemo, useRef, useEffect, ReactElement } from 'react';
import type { ConfigurationContribution } from '../manifest';
import { validateConfig } from '../config/schemaValidator';
import { defaultFieldRendererRegistry } from '../config/fieldRenderers';
import type { FieldRendererRegistry } from '../config/fieldRenderers';
import type { ConfigValueError } from '../config/types';

interface Props {
  schema: ConfigurationContribution;
  initialValues: Record<string, unknown>;
  onSave:   (values: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  compact?: boolean;
  registry?: FieldRendererRegistry;
}

const STACK_CAP = 50;

export function PluginConfigForm(p: Props): ReactElement {
  const [values, setValues] = useState<Record<string, unknown>>(p.initialValues);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const undoStack = useRef<Record<string, unknown>[]>([]);
  const redoStack = useRef<Record<string, unknown>[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const registry = p.registry ?? defaultFieldRendererRegistry;

  const errors = useMemo<ConfigValueError[]>(
    () => validateConfig(p.schema, values),
    [p.schema, values]
  );
  const errorsByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of errors) m[e.key] = e.message;
    return m;
  }, [errors]);

  const pushUndo = (prev: Record<string, unknown>) => {
    undoStack.current.push(prev);
    if (undoStack.current.length > STACK_CAP) undoStack.current.shift();
    redoStack.current = [];
  };

  const commit = (key: string, value: unknown) => {
    setValues(prev => {
      if (prev[key] === value) return prev;
      pushUndo(prev);
      return { ...prev, [key]: value };
    });
    setDirtyKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleUndo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setValues(curr => {
      redoStack.current.push(curr);
      return prev;
    });
  };

  const handleRedo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    setValues(curr => {
      undoStack.current.push(curr);
      return next;
    });
  };

  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, []);

  const canSave = dirtyKeys.size > 0 && errors.length === 0;

  const save = async () => {
    if (!canSave) return;
    await p.onSave(values);
    setDirtyKeys(new Set());
    undoStack.current = [];
    redoStack.current = [];
  };

  const cancel = () => {
    setValues(p.initialValues);
    setDirtyKeys(new Set());
    undoStack.current = [];
    redoStack.current = [];
    p.onCancel();
  };

  return (
    <form ref={formRef} className={`plugin-config-form${p.compact ? ' compact' : ''}`}
          onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {!p.compact && <h3>{p.schema.title}</h3>}
      {Object.entries(p.schema.properties).map(([key, propSchema]) => {
        const r = registry.find(propSchema);
        if (!r) return <div key={key}><em>(no renderer for {key})</em></div>;
        const fieldId = `field-${key}`;
        return (
          <div key={key} className="form-row">
            <label htmlFor={fieldId}>{propSchema.title ?? key}</label>
            {r.render({
              id: fieldId,
              schema: propSchema,
              value: values[key],
              error: errorsByKey[key],
              onCommit: (v) => commit(key, v),
            })}
            {propSchema.description && (
              <small className="field-description">{propSchema.description}</small>
            )}
          </div>
        );
      })}
      <div className="form-actions">
        <button type="submit" disabled={!canSave}>Save</button>
        <button type="button" onClick={cancel}>Cancel</button>
      </div>
    </form>
  );
}
