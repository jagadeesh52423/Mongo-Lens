import type { TabFormProps } from './types';
import type { ConnectionTarget } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';

export function ServerTab({ value, onChange }: TabFormProps) {
  const target = value.target;

  function setTarget(t: ConnectionTarget) {
    onChange({ ...value, target: t });
  }

  function switchKind(nextKind: 'direct' | 'uri') {
    if (nextKind === target.kind) return;
    // Warn if there's existing data we'd discard
    const hasData =
      (target.kind === 'direct' && (target.host || target.port !== 27017)) ||
      (target.kind === 'uri' && target.uri);
    if (hasData && !window.confirm('Switching will discard the current Server tab values. Continue?')) {
      return;
    }
    setTarget(
      nextKind === 'direct'
        ? { kind: 'direct', host: '', port: 27017 }
        : { kind: 'uri', uri: '' },
    );
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Target type" style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <label>
          <input type="radio" name="target-kind" checked={target.kind === 'direct'} onChange={() => switchKind('direct')} />
          Direct
        </label>
        <label>
          <input type="radio" name="target-kind" checked={target.kind === 'uri'} onChange={() => switchKind('uri')} />
          Connection URI
        </label>
      </div>

      {target.kind === 'direct' && (
        <div style={{ display: 'flex', gap: 12 }}>
          <FormField>
            <FormField.Label htmlFor="srv-host">Host</FormField.Label>
            <FormField.Input
              id="srv-host"
              value={target.host}
              onChange={(e) => setTarget({ ...target, host: e.target.value })}
            />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="srv-port">Port</FormField.Label>
            <FormField.Input
              id="srv-port"
              type="number"
              value={target.port}
              onChange={(e) => setTarget({ ...target, port: Number(e.target.value) })}
            />
          </FormField>
        </div>
      )}

      {target.kind === 'uri' && (
        <FormField>
          <FormField.Label htmlFor="srv-uri">URI string</FormField.Label>
          <FormField.Input
            id="srv-uri"
            value={target.uri}
            onChange={(e) => setTarget({ ...target, uri: e.target.value })}
            placeholder="mongodb+srv://…"
          />
        </FormField>
      )}
    </div>
  );
}
