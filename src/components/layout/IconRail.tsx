import type { ActivityItem } from '../../layout/activityBar';

interface Props {
  items: ActivityItem[];
  activeId: string | null;
  onChange: (id: string) => void;
  onSettingsOpen: () => void;
  settingsOpen: boolean;
}

export function IconRail({ items, activeId, onChange, onSettingsOpen, settingsOpen }: Props) {
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
      {items.map((it) => {
        const isActive = !settingsOpen && activeId === it.id;
        return (
          <button
            key={it.id}
            aria-label={it.title}
            onClick={() => onChange(it.id)}
            style={{
              height: 44,
              border: 'none',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
              color: isActive ? 'var(--fg)' : 'var(--fg-dim)',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            {it.icon}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button
        aria-label="Settings"
        onClick={onSettingsOpen}
        style={{
          height: 44,
          border: 'none',
          borderLeft: settingsOpen ? '2px solid var(--accent)' : '2px solid transparent',
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
