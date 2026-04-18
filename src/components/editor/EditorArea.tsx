import { useState } from 'react';
import { useEditorStore } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';
import { ScriptEditor } from './ScriptEditor';
import { runScript, cancelScript } from '../../ipc';
import { useResultsStore } from '../../store/results';
import { ResultsPanel } from '../results/ResultsPanel';
import { useCollectionCompletions } from '../../hooks/useCollectionCompletions';

export function EditorArea() {
  const { tabs, activeTabId, setActive, closeTab, updateContent, openTab } = useEditorStore();
  const { activeConnectionId, activeDatabase } = useConnectionsStore();
  const startRun = useResultsStore((s) => s.startRun);
  const finishRun = useResultsStore((s) => s.finishRun);
  const setError = useResultsStore((s) => s.setError);
  const active = tabs.find((t) => t.id === activeTabId);
  const completions = useCollectionCompletions(activeConnectionId, activeDatabase);
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const activePageSize = active ? (pageSizes[active.id] ?? 50) : 50;
  const isRunning = useResultsStore((s) => (active ? !!s.byTab[active.id]?.isRunning : false));

  async function handleRun(page = 0, pageSize = activePageSize) {
    if (!active || active.type !== 'script') return;
    const connId = active.connectionId ?? activeConnectionId;
    const db = active.database ?? activeDatabase;
    if (!connId || !db) {
      alert('Select a connection and database first');
      return;
    }
    const runId = crypto.randomUUID();
    console.log('[handleRun] tabId:', active.id, 'connId:', connId, 'db:', db, 'page:', page, 'pageSize:', pageSize, 'runId:', runId);
    startRun(active.id, runId);
    try {
      await runScript(active.id, connId, db, active.content, page, pageSize, runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'cancelled') return;
      console.error('[handleRun] runScript failed:', msg);
      setError(active.id, msg);
      finishRun(active.id, 0);
    }
  }

  async function handleCancel() {
    if (!active) return;
    await cancelScript(active.id);
    finishRun(active.id, 0);
  }

  function newScriptTab() {
    const id = `script:${Date.now()}`;
    openTab({
      id,
      title: 'untitled.js',
      content: '// write your MongoDB script here\n',
      isDirty: false,
      type: 'script',
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          height: 32,
          minHeight: 32,
        }}
      >
        <div style={{ display: 'flex', overflow: 'auto', flex: 1 }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                padding: '0 10px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                background: t.id === activeTabId ? 'var(--bg)' : 'transparent',
                borderRight: '1px solid var(--border)',
              }}
            >
              <span>
                {t.title}
                {t.isDirty && ' •'}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                style={{ color: 'var(--fg-dim)' }}
              >
                ✕
              </span>
            </div>
          ))}
          <button onClick={newScriptTab} style={{ margin: '0 6px' }}>
            + New
          </button>
        </div>
        <div style={{ paddingRight: 10, display: 'flex', gap: 6 }}>
          <button
            onClick={() => handleRun(0)}
            disabled={!active || active.type !== 'script' || isRunning}
          >
            ▶ Run
          </button>
          {isRunning && (
            <button onClick={handleCancel}>
              ✕ Cancel
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!active && (
          <div style={{ padding: 20, color: 'var(--fg-dim)' }}>No editor tab open.</div>
        )}
        {active?.type === 'script' && (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ScriptEditor
                value={active.content}
                onChange={(v) => updateContent(active.id, v)}
                onRun={() => handleRun(0)}
                collections={completions.map((c) => c.name)}
              />
            </div>
            <div style={{ height: 260, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              <ResultsPanel
                tabId={active.id}
                pageSize={activePageSize}
                onPageChange={(page, pageSize) => handleRun(page, pageSize)}
                onPageSizeChange={(size) => setPageSizes((prev) => ({ ...prev, [active.id]: size }))}
                connectionId={active.connectionId}
                database={active.database}
                collection={active.collection}
                onDocUpdated={() => handleRun(0, activePageSize)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
