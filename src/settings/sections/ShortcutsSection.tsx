import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  keyboardService,
  formatKeyCombo,
  serializeKeyCombo,
  deserializeKeyCombo,
  type KeyCombo,
  type ShortcutDefinition,
} from '../../services/KeyboardService';
import { useSettingsStore } from '../../store/settings';
import { register } from '../registry';
import { ContextMenu } from '../../components/ui/ContextMenu';

const MODIFIER_KEYS = new Set(['meta', 'control', 'shift', 'alt', 'option', 'command']);

const RESERVED_COMBOS = new Set<string>([
  'cmd+q',
  'cmd+w',
  'cmd+h',
  'cmd+m',
  'cmd+tab',
  'cmd+space',
  'cmd+shift+3',
  'cmd+shift+4',
  'cmd+shift+5',
]);

const GLOBAL_SCOPE = 'global';

const SCOPE_LABELS: Record<string, string> = {
  global: 'Global',
  results: 'Results Pane',
};

function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope.charAt(0).toUpperCase() + scope.slice(1);
}

function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  const key = e.key;
  if (!key || MODIFIER_KEYS.has(key.toLowerCase())) return null;
  return {
    cmd: e.metaKey,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: key.length === 1 ? key.toLowerCase() : key,
  };
}

function effectiveCombo(
  shortcut: ShortcutDefinition,
  overrides: Record<string, string>,
): KeyCombo {
  const override = overrides[shortcut.id];
  if (override) return deserializeKeyCombo(override);
  return shortcut.keys;
}

function groupByScope(shortcuts: ShortcutDefinition[]): Array<[string, ShortcutDefinition[]]> {
  const groups = new Map<string, ShortcutDefinition[]>();
  for (const s of shortcuts) {
    const list = groups.get(s.scope);
    if (list) list.push(s);
    else groups.set(s.scope, [s]);
  }
  const scopes = Array.from(groups.keys());
  scopes.sort((a, b) => {
    if (a === GLOBAL_SCOPE) return -1;
    if (b === GLOBAL_SCOPE) return 1;
    return a.localeCompare(b);
  });
  return scopes.map((scope) => [scope, groups.get(scope)!]);
}

export function ShortcutsSection() {
  const shortcutOverrides = useSettingsStore((s) => s.shortcutOverrides);
  const setShortcutOverride = useSettingsStore((s) => s.setShortcutOverride);
  const resetShortcut = useSettingsStore((s) => s.resetShortcut);
  const resetAllShortcuts = useSettingsStore((s) => s.resetAllShortcuts);

  const [listeningId, setListeningId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const shortcuts = useMemo(() => keyboardService.getDefinitions(), []);
  const grouped = useMemo(() => groupByScope(shortcuts), [shortcuts]);
  const hasOverrides = Object.keys(shortcutOverrides).length > 0;

  useEffect(() => {
    if (!listeningId) return;
    const activeId: string = listeningId;
    const activeShortcut = shortcuts.find((s) => s.id === activeId);
    if (!activeShortcut) return;
    const activeScope = activeShortcut.scope;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setListeningId(null);
        setErrorId(null);
        setErrorMsg(null);
        return;
      }

      const combo = comboFromEvent(e);
      if (!combo) return;

      const serialized = serializeKeyCombo(combo);

      if (RESERVED_COMBOS.has(serialized)) {
        setErrorId(activeId);
        setErrorMsg('Reserved by system key');
        return;
      }

      const conflict = shortcuts.find((s) => {
        if (s.id === activeId) return false;
        if (s.scope !== activeScope) return false;
        const existing = serializeKeyCombo(effectiveCombo(s, shortcutOverrides));
        return existing === serialized;
      });

      if (conflict) {
        setErrorId(activeId);
        setErrorMsg(`Already used by ${conflict.label}`);
        return;
      }

      setShortcutOverride(activeId, serialized);
      setListeningId(null);
      setErrorId(null);
      setErrorMsg(null);
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningId, shortcuts, shortcutOverrides, setShortcutOverride]);

  function handleReset(id: string) {
    resetShortcut(id);
    if (errorId === id) {
      setErrorId(null);
      setErrorMsg(null);
    }
  }

  function handleResetAll() {
    resetAllShortcuts();
    setErrorId(null);
    setErrorMsg(null);
  }

  function handleRowContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id });
  }

  function handleChipClick(id: string) {
    setListeningId(id);
    setErrorId(null);
    setErrorMsg(null);
  }

  return (
    <div style={containerStyle}>
      <div style={headerRowStyle}>
        <h2 style={headingStyle}>Keyboard Shortcuts</h2>
        <button
          type="button"
          onClick={handleResetAll}
          disabled={!hasOverrides}
          style={resetAllButtonStyle(!hasOverrides)}
        >
          Reset All
        </button>
      </div>
      <div style={descStyle}>Click a binding to rebind. Right-click a row to reset.</div>

      {shortcuts.length === 0 ? (
        <div style={emptyStyle}>No shortcuts registered.</div>
      ) : (
        grouped.map(([scope, items]) => (
          <div key={scope} style={scopeBlockStyle}>
            <div style={scopeHeadingStyle}>{scopeLabel(scope)}</div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Action</th>
                  <th style={{ ...thStyle, width: 220 }}>Binding</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const combo = effectiveCombo(s, shortcutOverrides);
                  const isListening = listeningId === s.id;
                  const hasError = errorId === s.id;
                  const isOverridden = !!shortcutOverrides[s.id];
                  return (
                    <tr
                      key={s.id}
                      onContextMenu={(e) => handleRowContextMenu(e, s.id)}
                      style={rowStyle}
                    >
                      <td style={tdStyle}>
                        <span>{s.label}</span>
                        {isOverridden && (
                          <span style={overriddenBadgeStyle} title="Customized">
                            custom
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleChipClick(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleChipClick(s.id);
                            }
                          }}
                          style={chipStyle(isListening, hasError)}
                          className={isListening ? 'shortcut-chip-listening' : undefined}
                        >
                          {isListening ? 'Press new key…' : formatKeyCombo(combo)}
                        </div>
                        {hasError && errorMsg && (
                          <div style={errorStyle}>{errorMsg}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: 'Reset to default',
              action: () => handleReset(contextMenu.id),
              disabled: !shortcutOverrides[contextMenu.id],
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      <style>{pulseKeyframes}</style>
    </div>
  );
}

const pulseKeyframes = `
@keyframes shortcutPulse {
  0%, 100% { border-color: var(--accent); box-shadow: 0 0 0 0 rgba(0, 237, 100, 0.4); }
  50% { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(0, 237, 100, 0); }
}
.shortcut-chip-listening { animation: shortcutPulse 1.2s ease-in-out infinite; }
`;

const containerStyle: CSSProperties = {
  padding: 20,
  maxWidth: 720,
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 4,
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
};

const descStyle: CSSProperties = {
  color: 'var(--fg-dim)',
  fontSize: 12,
  marginBottom: 16,
};

const scopeBlockStyle: CSSProperties = {
  marginBottom: 24,
};

const scopeHeadingStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fg)',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const emptyStyle: CSSProperties = {
  padding: '10px 12px',
  color: 'var(--fg-dim)',
  textAlign: 'center',
  fontSize: 13,
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--fg-dim)',
  fontWeight: 500,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const rowStyle: CSSProperties = {
  borderBottom: '1px solid var(--border)',
};

const tdStyle: CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
};

const overriddenBadgeStyle: CSSProperties = {
  marginLeft: 8,
  padding: '1px 6px',
  borderRadius: 3,
  background: 'var(--bg-hover)',
  color: 'var(--fg-dim)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

function chipStyle(isListening: boolean, hasError: boolean): CSSProperties {
  return {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${hasError ? 'var(--accent-red)' : isListening ? 'var(--accent)' : 'var(--border)'}`,
    background: 'var(--bg-panel)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    cursor: 'pointer',
    userSelect: 'none',
    minWidth: 80,
    textAlign: 'center',
    color: isListening ? 'var(--accent)' : 'inherit',
  };
}

function resetAllButtonStyle(disabled: boolean): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: disabled ? 'var(--fg-dim)' : 'var(--fg)',
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

const errorStyle: CSSProperties = {
  marginTop: 4,
  color: 'var(--accent-red)',
  fontSize: 11,
};

register({ id: 'shortcuts', label: 'Keyboard Shortcuts', icon: '⌨️', component: ShortcutsSection });
