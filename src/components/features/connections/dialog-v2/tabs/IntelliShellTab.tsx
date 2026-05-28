import type { TabFormProps } from './types';
import type { IntelliShellOverrides } from '../../../../../connection/model';
import { OverrideRow } from './shared/OverrideRow';

export function IntelliShellTab({ value, onChange, globals }: TabFormProps) {
  const ovr: IntelliShellOverrides = value.overrides?.intelliShell ?? {};

  function patch<K extends keyof IntelliShellOverrides>(field: K, next: IntelliShellOverrides[K]) {
    onChange({
      ...value,
      overrides: {
        ...value.overrides,
        intelliShell: { ...ovr, [field]: next },
      },
    });
  }

  return (
    <>
      <OverrideRow
        label="Command timeout (ms)"
        globalValue={globals.intelliShell.commandTimeoutMs}
        value={ovr.commandTimeoutMs}
        onChange={(next) => patch('commandTimeoutMs', next)}
        type="number"
      />
      <OverrideRow
        label="Auto-complete enabled"
        globalValue={globals.intelliShell.autoCompleteEnabled}
        value={ovr.autoCompleteEnabled}
        onChange={(next) => patch('autoCompleteEnabled', next)}
        type="boolean"
      />
      <OverrideRow
        label="Print limit"
        globalValue={globals.intelliShell.printLimit}
        value={ovr.printLimit}
        onChange={(next) => patch('printLimit', next)}
        type="number"
      />
    </>
  );
}

export function hasIntelliShellOverrides(c: { overrides?: { intelliShell?: IntelliShellOverrides } }) {
  const ovr = c.overrides?.intelliShell;
  return !!ovr && Object.values(ovr).some((v) => v !== undefined);
}
