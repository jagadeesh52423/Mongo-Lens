import { useState } from 'react';
import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getThemes, registerTheme, type ThemeDefinition } from '../../themes/registry';
import { applyTheme, applyMonacoTheme } from '../../themes/applyTheme';
import { useSettingsStore } from '../../store/settings';
import { register } from '../registry';
import { ThemeEditor } from './ThemeEditor';

interface ThemeCardAction {
  icon: string;
  label: string;
  onClick: (theme: ThemeDefinition) => void;
}

export function ThemeSection() {
  const [themes, setThemes] = useState<ThemeDefinition[]>(() => getThemes());
  const [error, setError] = useState<string | null>(null);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const activeThemeId = useSettingsStore((s) => s.themeId);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const activate = (id: string) => {
    applyTheme(id);
    applyMonacoTheme(id);
    setTheme(id);
  };

  const handleInstall = async () => {
    setError(null);
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Theme JSON', extensions: ['json'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      const text = await readTextFile(selected);
      const parsed = JSON.parse(text);
      if (!isValidThemeDefinition(parsed)) {
        setError('Invalid theme file: missing id, name, or variables');
        return;
      }
      registerTheme(parsed);
      setThemes(getThemes());
      activate(parsed.id);
    } catch (err) {
      setError(`Failed to install theme: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExport = async (theme: ThemeDefinition) => {
    setError(null);
    try {
      const json = JSON.stringify(
        { id: theme.id, name: theme.name, variables: theme.variables },
        null,
        2,
      );
      const path = await save({
        defaultPath: `${theme.name}.json`,
        filters: [{ name: 'Theme JSON', extensions: ['json'] }],
      });
      if (!path) return;
      await writeTextFile(path, json);
    } catch (err) {
      setError(`Failed to export theme: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const actions: ThemeCardAction[] = [
    { icon: '✎', label: 'Edit theme', onClick: (theme) => setEditingThemeId(theme.id) },
    { icon: '⬇', label: 'Export theme', onClick: handleExport },
  ];

  if (editingThemeId !== null) {
    return <ThemeEditor themeId={editingThemeId} onBack={() => setEditingThemeId(null)} />;
  }

  return (
    <div style={{ padding: 24, color: 'var(--fg)' }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Theme</h2>
      <p style={{ margin: '4px 0 20px', color: 'var(--fg-dim)', fontSize: 12 }}>
        Choose a preset or install an external theme.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            active={theme.id === activeThemeId}
            onClick={() => activate(theme.id)}
            actions={actions}
          />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={handleInstall}>Install External Theme… (Choose File)</button>
        {error && (
          <span style={{ color: 'var(--accent-red)', fontSize: 12 }}>{error}</span>
        )}
      </div>
    </div>
  );
}

interface ThemeCardProps {
  theme: ThemeDefinition;
  active: boolean;
  onClick: () => void;
  actions: ThemeCardAction[];
}

function ThemeCard({ theme, active, onClick, actions }: ThemeCardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const bg = theme.variables['--bg'] ?? '#000';
  const panel = theme.variables['--bg-panel'] ?? bg;
  const accent = theme.variables['--accent'] ?? '#fff';
  const fg = theme.variables['--fg'] ?? '#ccc';
  const actionsVisible = hovered || focused;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: 0,
        borderRadius: 6,
        border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
        background: 'var(--bg-panel)',
        cursor: 'pointer',
        overflow: 'hidden',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: 64,
          background: bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: `1px solid ${panel}`,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <Swatch color={bg} border={fg} />
          <Swatch color={panel} border={fg} />
          <Swatch color={accent} border={fg} />
        </div>
        {actionsVisible && actions.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              display: 'flex',
              gap: 4,
            }}
          >
            {actions.map((action) => (
              <button
                key={action.label}
                title={action.label}
                aria-label={action.label}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick(theme);
                }}
                style={{
                  width: 22,
                  height: 22,
                  padding: 0,
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-panel)',
                  color: 'var(--fg)',
                  fontSize: 12,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {action.icon}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500 }}>{theme.name}</span>
        {active && (
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓ Active</span>
        )}
      </div>
    </div>
  );
}

function Swatch({ color, border }: { color: string; border: string }) {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: color,
        border: `1px solid ${border}`,
        opacity: 0.9,
      }}
    />
  );
}

function isValidThemeDefinition(value: unknown): value is ThemeDefinition {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (typeof obj.name !== 'string' || !obj.name) return false;
  if (!obj.variables || typeof obj.variables !== 'object') return false;
  const vars = obj.variables as Record<string, unknown>;
  return Object.values(vars).every((v) => typeof v === 'string');
}

register({ id: 'theme', label: 'Theme', icon: '🎨', component: ThemeSection });
