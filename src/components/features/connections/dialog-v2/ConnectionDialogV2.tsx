import { useEffect, useMemo, useReducer, useState } from 'react';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { ColorPicker } from './tabs/shared/ColorPicker';
import { TABS } from './tabs/registry';
import { dialogReducer, initialDialogState } from './useDialogState';
import { useConnectionsV2 } from '../useConnectionsV2';
import { validateConnection } from '../../../../connection/validation';
import { isBlankSsh, isBlankProxy, isBlankTls } from '../../../../connection/feature-state';
import { stageHeading } from '../../../../connection/staged-error';
import type { Connection } from '../../../../connection/model';
import type { GlobalPrefs } from '../../../../connection/overrides';
import type { SaveInput, SecretInput, SecretSlot, SecretSlotName } from '../../../../connection/ipc';
import { getSecretsV2 } from '../../../../connection/ipc';
import styles from './ConnectionDialogV2.module.css';

interface Props {
  initial: Connection | null;
  globals: GlobalPrefs;
  onSave: (input: SaveInput) => Promise<Connection>;
  onCancel: () => void;
}

/** Collects the `state.secrets` map into the wire-format `SecretInput[]`. */
function collectSecrets(secrets: Partial<Record<SecretSlot, string>>): SecretInput[] {
  return Object.entries(secrets)
    .filter(([, value]) => value !== undefined)
    .map(([slot, value]) => ({ slot: slot as SecretSlot, value: value as string }));
}

/**
 * Strips disabled-and-blank transport features so they are not persisted.
 * A feature that is toggled off and carries no user-entered data is dropped;
 * anything the user typed (even while disabled) is preserved.
 *
 * Extension contract: a new toggleable feature self-registers via its
 * `isBlank*` predicate in feature-state.ts — add one branch here keyed off it.
 */
function normalizeForSave(connection: Connection): Connection {
  const out: Connection = { ...connection };
  if (out.tls && isBlankTls(out.tls)) delete out.tls;
  if (out.ssh && isBlankSsh(out.ssh)) delete out.ssh;
  if (out.proxy && isBlankProxy(out.proxy)) delete out.proxy;
  return out;
}

/**
 * Keychain slots owned by each optional transport feature. When a feature is
 * dropped from the connection on save, its secrets would otherwise linger as
 * orphan inert keychain entries — `pruneSecrets` removes them.
 *
 * Extension contract: a new feature that owns secrets adds one entry here
 * (`present` predicate + its slots); `pruneSecrets` drops them automatically
 * when the feature is absent. No other edits needed.
 */
const FEATURE_SECRET_SLOTS: ReadonlyArray<{
  present: (connection: Connection) => boolean;
  slots: ReadonlyArray<SecretSlot>;
}> = [
  { present: (connection) => !!connection.ssh, slots: ['ssh-password', 'ssh-key-passphrase'] },
  { present: (connection) => !!connection.proxy, slots: ['proxy-password'] },
];

/**
 * Drops secrets belonging to features that are absent from the (already
 * normalized) connection, so save never carries orphan secrets for a feature
 * the user left blank and disabled.
 */
export function pruneSecrets(secrets: SecretInput[], connection: Connection): SecretInput[] {
  const dropped = new Set<SecretSlot>();
  for (const feature of FEATURE_SECRET_SLOTS) {
    if (!feature.present(connection)) feature.slots.forEach((slot) => dropped.add(slot));
  }
  return secrets.filter((secret) => !dropped.has(secret.slot));
}

/** Derives the header subtitle line from the dialog mode + target scheme. */
function subtitleFor(initial: Connection | null, draft: Connection): string {
  if (!initial) return 'New connection';
  const target = draft.target;
  const scheme = target.kind === 'uri'
    ? (target.uri.startsWith('mongodb+srv') ? 'mongodb+srv' : 'mongodb')
    : 'direct';
  return `Editing connection · ${scheme}`;
}

export function ConnectionDialogV2({ initial, globals, onSave, onCancel }: Props) {
  const [state, dispatch] = useReducer(dialogReducer, undefined, () => initialDialogState(initial, globals));
  const [activeTabId, setActiveTabId] = useState<string>('server');
  const [saving, setSaving] = useState(false);
  const [secretsLoading, setSecretsLoading] = useState(false);

  useEffect(() => {
    if (!initial?.id) return;
    setSecretsLoading(true);
    getSecretsV2(initial.id)
      .then((secrets) => {
        for (const [slot, value] of Object.entries(secrets)) {
          dispatch({ type: 'set-secret', slot: slot as SecretSlotName, value });
        }
      })
      .catch(() => {
        // Non-fatal: secrets will be empty and the user can re-enter them
      })
      .finally(() => setSecretsLoading(false));
  }, [initial?.id]);
  const issues = useMemo(() => validateConnection(state.draft), [state.draft]);
  const issuesByTab = useMemo(() => new Map(TABS.map((t) => [t.id, t.validate(state.draft)])), [state.draft]);
  const activeTab = TABS.find((t) => t.id === activeTabId) ?? TABS[0];
  const transportTabs = TABS.filter((t) => t.group === 'transport');
  const prefsTabs = TABS.filter((t) => t.group === 'prefs');
  const test = useConnectionsV2((store) => store.test);

  async function handleSave() {
    dispatch({ type: 'save-clear' });
    setSaving(true);
    const connection = normalizeForSave(state.draft);
    const secrets = pruneSecrets(collectSecrets(state.secrets), connection);
    try {
      await onSave({ connection, secrets });
    } catch (err) {
      dispatch({ type: 'save-error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    dispatch({ type: 'test-start' });
    const result = await test({ connection: state.draft, secrets: collectSecrets(state.secrets) });
    dispatch({ type: 'test-result', result });
  }

  const ActiveForm = activeTab.Form;

  return (
    <Dialog open onClose={onCancel} ariaLabel="Connection editor" width={720}>
      <div className={styles.header}>
        <ColorPicker
          value={state.draft.color}
          onChange={(c) => dispatch({ type: 'set-field', path: 'color', value: c })}
        />
        <div className={styles.titleBlock}>
          <input
            className={styles.titleInput}
            aria-label="Connection name"
            placeholder="Untitled connection"
            value={state.draft.name}
            onChange={(e) => dispatch({ type: 'set-field', path: 'name', value: e.target.value })}
          />
          <div className={styles.subtitle}>{subtitleFor(state.initial, state.draft)}</div>
        </div>
        <Button onClick={handleTest} disabled={issues.length > 0}>Test connection</Button>
      </div>

      <div className={styles.body}>
        {secretsLoading && <div className={styles.secretsLoading}>Loading saved credentials…</div>}
        <nav className={styles.sidebar} role="tablist" aria-label="Connection settings tabs">
          <div className={styles.glabel}>CONNECTION</div>
          {transportTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTabId === t.id}
              className={activeTabId === t.id ? styles.tabActive : styles.tab}
              onClick={() => setActiveTabId(t.id)}
            >
              {t.icon}
              {t.label}
              {(issuesByTab.get(t.id) ?? []).length > 0 && <span className={styles.errBadge}> ●</span>}
            </button>
          ))}
          {prefsTabs.length > 0 && <div className={styles.glabel}>PREFERENCES</div>}
          {prefsTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTabId === t.id}
              className={activeTabId === t.id ? styles.tabActive : styles.tab}
              onClick={() => setActiveTabId(t.id)}
            >
              {t.icon}
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
            onAuthKindChange={(kind) => dispatch({ type: 'set-auth-kind', kind })}
          />
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.issues}>
          {issues.length > 0 && (
            <span>
              ⚠ {issues.length === 1 ? '1 issue' : `${issues.length} issues`} across tabs
            </span>
          )}
          {issues.length === 0 && state.testResult?.kind === 'pending' && (
            <span>Testing…</span>
          )}
          {issues.length === 0 && state.testResult?.kind === 'ok' && (
            <span className={styles.testOk}>✓ Connection OK</span>
          )}
          {issues.length === 0 && state.testResult?.kind === 'fail' && (
            <div className={styles.testFail}>
              <strong>{stageHeading(state.testResult.stage)}</strong>: {state.testResult.error}
            </div>
          )}
          {issues.length === 0 && state.saveError && (
            <div className={styles.testFail}>
              <strong>Save failed</strong>: {state.saveError}
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={issues.length > 0 || saving} onClick={handleSave}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
