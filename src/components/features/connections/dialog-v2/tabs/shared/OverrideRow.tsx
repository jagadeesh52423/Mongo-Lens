import { Button } from '../../../../../ui/Button';
import { FormField } from '../../../../../ui/FormField';
import styles from './OverrideRow.module.css';

type Primitive = string | number | boolean;

interface Props<T extends Primitive> {
  label: string;
  globalValue: T;
  value: T | undefined;
  onChange: (next: T | undefined) => void;
  type?: 'text' | 'number' | 'boolean';
}

/**
 * Per-field override row. Encapsulates the
 *   undefined  → "Use global: <value>" hint
 *   any other  → user override (including false / 0 / '')
 *   Reset btn  → clears back to undefined
 * semantics shared by all preference tabs.
 *
 * To add support for a new input type: extend the `type` union and add a
 * branch in the render. No callers need to change.
 */
export function OverrideRow<T extends Primitive>({ label, globalValue, value, onChange, type = 'text' }: Props<T>) {
  const overridden = value !== undefined;
  const inputId = `ovr-${label}`;

  if (type === 'boolean') {
    const checked = (overridden ? value : globalValue) as boolean;
    return (
      <div className={styles.boolRow}>
        <label className={styles.boolLabel} htmlFor={inputId}>
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked as T)}
          />
          {' '}{label}
        </label>
        {overridden && (
          <Button type="button" onClick={() => onChange(undefined)}>Reset</Button>
        )}
      </div>
    );
  }

  return (
    <FormField>
      <FormField.Label htmlFor={inputId}>{label}</FormField.Label>
      <div className={styles.inputRow}>
        <FormField.Input
          id={inputId}
          type={type}
          value={(value ?? '') as string | number}
          placeholder={overridden ? '' : `Use global: ${String(globalValue)}`}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(undefined);
              return;
            }
            if (type === 'number') {
              const parsed = Number(raw);
              onChange(Number.isNaN(parsed) ? undefined : (parsed as T));
              return;
            }
            onChange(raw as T);
          }}
        />
        {overridden && (
          <Button type="button" onClick={() => onChange(undefined)}>Reset</Button>
        )}
      </div>
    </FormField>
  );
}
