import { useMemo, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useResultsStore } from '../../store/results';
import { JsonView } from './JsonView';
import { TableView } from './TableView';
import { toCsv, toJsonText } from '../../utils/export';

interface Props {
  tabId: string;
}

export function ResultsPanel({ tabId }: Props) {
  const res = useResultsStore((s) => s.byTab[tabId]);
  const [view, setView] = useState<'json' | 'table'>('json');

  const allDocs = useMemo(() => {
    if (!res) return [];
    return res.groups.flatMap((g) => g.docs);
  }, [res]);

  async function exportAs(kind: 'csv' | 'json') {
    const suggested = kind === 'csv' ? 'results.csv' : 'results.json';
    const path = await saveDialog({ defaultPath: suggested });
    if (!path) return;
    const content = kind === 'csv' ? toCsv(allDocs) : toJsonText(allDocs);
    await writeTextFile(path as string, content);
  }

  if (!res || (res.groups.length === 0 && !res.isRunning && !res.lastError)) {
    return (
      <div style={{ padding: 12, color: 'var(--fg-dim)' }}>
        Run a script to see results.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        <button onClick={() => setView('json')} disabled={view === 'json'}>JSON</button>
        <button onClick={() => setView('table')} disabled={view === 'table'}>Table</button>
        <button onClick={() => exportAs('csv')} disabled={allDocs.length === 0}>Export CSV</button>
        <button onClick={() => exportAs('json')} disabled={allDocs.length === 0}>Export JSON</button>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-dim)', fontSize: 11 }}>
          {res.isRunning ? 'Running…' : `${allDocs.length} docs · ${res.executionMs ?? 0} ms`}
        </span>
      </div>
      {res.lastError && (
        <div style={{ padding: 8, color: 'var(--accent-red)', fontFamily: 'var(--font-mono)' }}>
          {res.lastError}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'json' ? <JsonView docs={allDocs} /> : <TableView docs={allDocs} />}
      </div>
    </div>
  );
}
