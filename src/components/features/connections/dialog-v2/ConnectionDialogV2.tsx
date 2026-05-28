import { useMemo, useReducer, useState } from 'react';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { FormField } from '../../../ui/FormField';
import { ColorPicker } from './tabs/shared/ColorPicker';
import { TABS } from './tabs/registry';
import { dialogReducer, initialDialogState } from './useDialogState';
import { validateConnection } from '../../../../connection/validation';
import type { Connection } from '../../../../connection/model';
import type { GlobalPrefs } from '../../../../connection/overrides';
import type { SaveInput, SecretInput, SecretSlot } from '../../../../connection/ipc';
import styles from './ConnectionDialogV2.module.css';

interface Props {
  initial: Connection | null;
  globals: GlobalPrefs;
  onSave: (input: SaveInput) => Promise<Connection>;
  onCancel: () => void;
}

export function ConnectionDialogV2({ initial, globals, onSave, onCancel }: Props) {
  const [state, dispatch] = useReducer(dialogReducer, undefined, () => initialDialogState(initial, globals));
  const [activeTabId, setActiveTabId] = useState<string>('server');
  const issues = useMemo(() => validateConnection(state.draft), [state.draft]);
  const issuesByTab = useMemo(() => new Map(TABS.map((t) => [t.id, t.validate(state.draft)])), [state.draft]);
  const activeTab = TABS.find((t) => t.id === activeTabId) ?? TABS[0];
  const transportTabs = TABS.filter((t) => t.group === 'transport');
  const prefsTabs = TABS.filter((t) => t.group === 'prefs');

  function handleSave() {
    const secrets: SecretInput[] = Object.entries(state.secrets)
      .filter(([, v]) => v !== undefined)
      .map(([slot, value]) => ({ slot: slot as SecretSlot, value: value as string }));
    onSave({ connection: state.draft, secrets });
  }

  const ActiveForm = activeTab.Form;

  return (
    <Dialog open onClose={onCancel} ariaLabel="Connection editor" width={720}>
      <div className={styles.header}>
        <FormField>
          <FormField.Label htmlFor="conn-name">Connection name</FormField.Label>
          <FormField.Input
            id="conn-name"
            value={state.draft.name}
            onChange={(e) => dispatch({ type: 'set-field', path: 'name', value: e.target.value })}
          />
        </FormField>
        <ColorPicker
          value={state.draft.color}
          onChange={(c) => dispatch({ type: 'set-field', path: 'color', value: c })}
        />
      </div>

      <div className={styles.body}>
        <nav className={styles.sidebar} role="tablist" aria-label="Connection settings tabs">
          {transportTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTabId === t.id}
              className={activeTabId === t.id ? styles.tabActive : styles.tab}
              onClick={() => setActiveTabId(t.id)}
            >
              {t.label}
              {(issuesByTab.get(t.id) ?? []).length > 0 && <span className={styles.errBadge}> ●</span>}
            </button>
          ))}
          {prefsTabs.length > 0 && <hr className={styles.divider} />}
          {prefsTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTabId === t.id}
              className={activeTabId === t.id ? styles.tabActive : styles.tab}
              onClick={() => setActiveTabId(t.id)}
            >
              {t.label}
              {t.hasOverrides?.(state.draft) && <span className={styles.overrideBadge}> ●</span>}
            </button>
          ))}
        </nav>
        <div role="tabpanel" className={styles.panel}>
          <ActiveForm
            value={state.draft}
            onChange={(next) => dispatch({ type: 'set-field', path: '', value: next })}
            globals={state.globals}
            secrets={state.secrets}
            onSecretChange={(slot, value) => dispatch({ type: 'set-secret', slot, value })}
          />
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.issues}>
          {issues.length > 0 && <span>⚠ {issues.length} issues across tabs</span>}
        </div>
        <div className={styles.actions}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={issues.length > 0} onClick={handleSave}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
