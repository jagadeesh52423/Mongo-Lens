import { ReactElement } from 'react';
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
    <ul className="plugin-list" role="list">
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
          >
            <strong>{rec.manifest?.name ?? rec.id}</strong>
            {rec.manifest && <> v{rec.manifest.version}</>}
            {sev === 'warning' && <span aria-label="warnings"> ⚠</span>}
            {sev === 'error'   && <span aria-label="errors">   ⛔</span>}
          </li>
        );
      })}
    </ul>
  );
}
