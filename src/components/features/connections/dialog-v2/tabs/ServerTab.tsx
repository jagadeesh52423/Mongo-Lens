import type { TabFormProps } from './types';
import type { ConnectionTarget } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import { SegmentedControl } from '../../../../ui';
import styles from './ServerTab.module.css';

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
      <div className={styles.segRow}>
        <SegmentedControl
          ariaLabel="Target type"
          value={target.kind}
          options={[{ value: 'direct', label: 'Direct' }, { value: 'uri', label: 'Connection URI' }]}
          onChange={(k) => switchKind(k)}
        />
      </div>

      {target.kind === 'direct' && (
        <div className={styles.fieldRow}>
          <FormField>
            <FormField.Label htmlFor="srv-host">Host</FormField.Label>
            <FormField.Input
              id="srv-host"
              className={styles.mono}
              value={target.host}
              onChange={(e) => setTarget({ ...target, host: e.target.value })}
            />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="srv-port">Port</FormField.Label>
            <FormField.Input
              id="srv-port"
              type="number"
              className={styles.mono}
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
            className={styles.mono}
            value={target.uri}
            onChange={(e) => setTarget({ ...target, uri: e.target.value })}
            placeholder="mongodb+srv://…"
          />
        </FormField>
      )}
    </div>
  );
}
