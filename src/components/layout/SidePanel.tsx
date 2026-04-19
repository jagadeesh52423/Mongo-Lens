import type { PanelKey } from './IconRail';

interface Props {
  active: PanelKey;
  children?: React.ReactNode;
}

const titles: Record<PanelKey, string> = {
  connections: 'Connections',
  collections: 'Collections',
  saved: 'Saved Scripts',
};

export function SidePanel({ active, children }: Props) {
  return (
    <div
      style={{
        width: 280,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        data-testid="side-panel-title"
        style={{
          padding: '8px 12px',
          fontSize: 11,
          textTransform: 'uppercase',
          color: 'var(--fg-dim)',
          letterSpacing: 1,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {titles[active]}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </div>
  );
}
