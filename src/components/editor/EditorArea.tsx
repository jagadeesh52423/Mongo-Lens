import { useEditorStore } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';
import { ScriptEditor } from './ScriptEditor';
import { BrowseTab } from './BrowseTab';
import { runScript } from '../../ipc';
import { useResultsStore } from '../../store/results';
import { ResultsPanel } from '../results/ResultsPanel';
import { useCollectionCompletions } from '../../hooks/useCollectionCompletions';

export function EditorArea() {
  const { tabs, activeTabId, setActive, closeTab, updateContent, openTab } = useEditorStore();
  const { activeConnectionId, activeDatabase } = useConnectionsStore();
  const startRun = useResultsStore((s) => s.startRun);
  const active = tabs.find((t) => t.id === activeTabId);
  const completions = useCollectionCompletions(activeConnectionId, activeDatabase);

  async function handleRun() {
    if (!active || active.type !== 'script') return;
    if (!activeConnectionId || !activeDatabase) {
      alert('Select a connection and database first');
      return;
    }
    startRun(active.id);
    await runScript(active.id, activeConnectionId, activeDatabase, active.content);
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
        <div style={{ paddingRight: 10 }}>
          <button onClick={handleRun} disabled={!active || active.type !== 'script'}>
            ▶ Run
          </button>
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
                onRun={handleRun}
                collections={completions.map((c) => c.name)}
              />
            </div>
            <div style={{ height: 260, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              <ResultsPanel tabId={active.id} />
            </div>
          </>
        )}
        {active?.type === 'browse' && active.connectionId && active.database && active.collection && (
          <BrowseTab
            connectionId={active.connectionId}
            database={active.database}
            collection={active.collection}
          />
        )}
      </div>
    </div>
  );
}
