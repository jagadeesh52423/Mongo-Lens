import { useRef } from 'react';
import type { TabFormProps } from './types';
import type { ConnectionTarget } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import { SegmentedControl } from '../../../../ui';
import styles from './ServerTab.module.css';

type DirectTarget = Extract<ConnectionTarget, { kind: 'direct' }>;
type UriTarget = Extract<ConnectionTarget, { kind: 'uri' }>;

const DEFAULT_DIRECT: DirectTarget = { kind: 'direct', host: '', port: 27017 };
const DEFAULT_URI: UriTarget = { kind: 'uri', uri: '' };

export function ServerTab({ value, onChange }: TabFormProps) {
  const target = value.target;
  // Remember the inactive mode's values so switching Direct↔URI doesn't lose
  // what the user typed; switching back restores it (within this dialog session).
  const stash = useRef<{ direct: DirectTarget; uri: UriTarget }>({
    direct: DEFAULT_DIRECT,
    uri: DEFAULT_URI,
  });

  function setTarget(t: ConnectionTarget) {
    onChange({ ...value, target: t });
  }

  function switchKind(nextKind: 'direct' | 'uri') {
    if (nextKind === target.kind) return;
    // Stash the current mode before leaving it, then restore the other mode's
    // last values (no data loss → no discard prompt needed).
    if (target.kind === 'direct') stash.current.direct = target;
    else stash.current.uri = target;
    setTarget(nextKind === 'direct' ? stash.current.direct : stash.current.uri);
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
