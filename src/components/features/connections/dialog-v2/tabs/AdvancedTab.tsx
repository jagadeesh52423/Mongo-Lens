import type { TabFormProps } from './types';
import type { AdvancedOverrides } from '../../../../../connection/model';
import { Button } from '../../../../ui/Button';
import { OverrideRow } from './shared/OverrideRow';
import styles from './AdvancedTab.module.css';

type Compressor = 'snappy' | 'zlib' | 'zstd';
const COMPRESSORS: Compressor[] = ['snappy', 'zlib', 'zstd'];

interface CompressorRowProps {
  globalValue: Compressor[];
  value: Compressor[] | undefined;
  onChange: (next: Compressor[] | undefined) => void;
}

function CompressorRow({ globalValue, value, onChange }: CompressorRowProps) {
  const overridden = value !== undefined;
  const active = overridden ? value : globalValue;

  function toggle(kind: Compressor, checked: boolean) {
    const base = overridden ? value : globalValue;
    const next = checked
      ? Array.from(new Set([...base, kind]))
      : base.filter((c) => c !== kind);
    onChange(next);
  }

  return (
    <>
      <div className={styles.compressorRow}>
        <span className={styles.compressorLabel}>Compressors</span>
        {overridden && (
          <Button type="button" onClick={() => onChange(undefined)}>Reset</Button>
        )}
      </div>
      <div className={styles.checkGroup}>
        {COMPRESSORS.map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={active.includes(kind)}
              onChange={(e) => toggle(kind, e.target.checked)}
            />
            {' '}{kind}
          </label>
        ))}
      </div>
      {!overridden && (
        <p className={styles.hint}>Use global: {globalValue.join(', ') || '(none)'}</p>
      )}
    </>
  );
}

export function AdvancedTab({ value, onChange, globals }: TabFormProps) {
  const ovr: AdvancedOverrides = value.overrides?.advanced ?? {};

  function patch<K extends keyof AdvancedOverrides>(field: K, next: AdvancedOverrides[K]) {
    onChange({
      ...value,
      overrides: {
        ...value.overrides,
        advanced: { ...ovr, [field]: next },
      },
    });
  }

  return (
    <>
      <OverrideRow
        label="App name"
        globalValue={globals.advanced.appName}
        value={ovr.appName}
        onChange={(next) => patch('appName', next)}
        type="text"
      />
      <OverrideRow
        label="Retry writes"
        globalValue={globals.advanced.retryWrites}
        value={ovr.retryWrites}
        onChange={(next) => patch('retryWrites', next)}
        type="boolean"
      />
      <OverrideRow
        label="Retry reads"
        globalValue={globals.advanced.retryReads}
        value={ovr.retryReads}
        onChange={(next) => patch('retryReads', next)}
        type="boolean"
      />
      <CompressorRow
        globalValue={globals.advanced.compressors}
        value={ovr.compressors}
        onChange={(next) => patch('compressors', next)}
      />
      <OverrideRow
        label="Server selection timeout (ms)"
        globalValue={globals.advanced.serverSelectionTimeoutMs}
        value={ovr.serverSelectionTimeoutMs}
        onChange={(next) => patch('serverSelectionTimeoutMs', next)}
        type="number"
      />
      <OverrideRow
        label="Connect timeout (ms)"
        globalValue={globals.advanced.connectTimeoutMs}
        value={ovr.connectTimeoutMs}
        onChange={(next) => patch('connectTimeoutMs', next)}
        type="number"
      />
      <OverrideRow
        label="Socket timeout (ms)"
        globalValue={globals.advanced.socketTimeoutMs}
        value={ovr.socketTimeoutMs}
        onChange={(next) => patch('socketTimeoutMs', next)}
        type="number"
      />
    </>
  );
}

export function hasAdvancedOverrides(c: { overrides?: { advanced?: AdvancedOverrides } }) {
  const ovr = c.overrides?.advanced;
  return !!ovr && Object.values(ovr).some((v) => v !== undefined);
}
