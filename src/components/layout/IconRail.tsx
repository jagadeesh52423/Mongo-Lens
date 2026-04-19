export type PanelKey = 'connections' | 'collections' | 'saved';

interface Props {
  active: PanelKey;
  onChange: (p: PanelKey) => void;
  onSettingsOpen: () => void;
  settingsOpen: boolean;
}

const items: { key: PanelKey; label: string; icon: string }[] = [
  { key: 'connections', label: 'Connections', icon: '⚡' },
  { key: 'collections', label: 'Collections', icon: '🗂' },
  { key: 'saved', label: 'Saved Scripts', icon: '⭐' },
];

export function IconRail({ active, onChange, onSettingsOpen, settingsOpen }: Props) {
  return (
    <div
      style={{
        width: 44,
        background: 'var(--bg-rail)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <img src="/logo.svg" alt="Logo" style={{ width: 24, height: 24 }} />
      </div>
      {items.map((it) => (
        <button
          key={it.key}
          aria-label={it.label}
          onClick={() => onChange(it.key)}
          style={{
            height: 44,
            border: 'none',
            borderLeft:
              !settingsOpen && active === it.key
                ? '2px solid var(--accent)'
                : '2px solid transparent',
            background: 'transparent',
            color: !settingsOpen && active === it.key ? 'var(--fg)' : 'var(--fg-dim)',
            fontSize: 18,
            cursor: 'pointer',
          }}
        >
          {it.icon}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button
        aria-label="Settings"
        onClick={onSettingsOpen}
        style={{
          height: 44,
          border: 'none',
          borderLeft: settingsOpen
            ? '2px solid var(--accent)'
            : '2px solid transparent',
          background: 'transparent',
          color: settingsOpen ? 'var(--fg)' : 'var(--fg-dim)',
          fontSize: 18,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ⚙
      </button>
    </div>
  );
}
