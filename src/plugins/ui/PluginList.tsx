import { CSSProperties, ReactElement } from 'react';
import type { PluginRecord } from '../PluginManager';

interface Props {
  records: PluginRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function severityOf(rec: PluginRecord): 'error' | 'warning' | 'none' {
  if (rec.findings.some(f => f.severity === 'error')) return 'error';
  if (rec.findings.some(f => f.severity === 'warning')) return 'warning';
  return 'none';
}

export function PluginList(p: Props): ReactElement {
  return (
    <ul className="plugin-list" role="list" style={listStyle}>
      {p.records.map((rec) => {
        const selected = p.selectedId === rec.id;
        const sev = severityOf(rec);
        return (
          <li
            key={rec.id}
            role="listitem"
            aria-selected={selected}
            data-severity={sev}
            onClick={() => p.onSelect(rec.id)}
            style={itemStyle(selected)}
            onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={nameStyle}>{rec.manifest?.name ?? rec.id}</span>
            {rec.manifest && <span style={versionStyle}>v{rec.manifest.version}</span>}
            {sev === 'warning' && <span aria-label="warnings" style={badgeStyle}>⚠</span>}
            {sev === 'error'   && <span aria-label="errors"   style={badgeStyle}>⛔</span>}
          </li>
        );
      })}
    </ul>
  );
}

const listStyle: CSSProperties = {
  width: 220,
  margin: 0,
  padding: '8px 0',
  listStyle: 'none',
  background: 'var(--bg)',
  borderRight: '1px solid var(--border)',
  flexShrink: 0,
  overflowY: 'auto',
};

function itemStyle(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    padding: '0 14px',
    background: selected ? 'var(--bg-hover)' : 'transparent',
    borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
    color: selected ? 'var(--fg)' : 'var(--fg-dim)',
    fontSize: 13,
    cursor: 'pointer',
    userSelect: 'none',
  };
}

const nameStyle: CSSProperties = {
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1,
  minWidth: 0,
};

const versionStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-dim)',
  marginRight: 4,
};

const badgeStyle: CSSProperties = {
  fontSize: 13,
  flexShrink: 0,
};
