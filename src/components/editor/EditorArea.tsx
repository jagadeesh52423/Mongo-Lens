import { useRef, useState } from 'react';
import { Panel, PanelGroup } from 'react-resizable-panels';
import { useEditorStore, DEFAULT_PANEL_SIZES } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';
import { ScriptEditor } from './ScriptEditor';
import { ContextBar } from './ContextBar';
import { runScript, cancelScript, createScript } from '../../ipc';
import { useResultsStore } from '../../store/results';
import { ResultsPanel } from '../results/ResultsPanel';
import { useCollectionCompletions } from '../../hooks/useCollectionCompletions';
import { SplitHandle } from '../shared/SplitHandle';
import { useTabActions } from '../../hooks/useTabActions';
import { newScriptTab } from '../../utils/newScriptTab';
import { getStatementAtCursor } from '../../utils/statementDetection';
import { getExecutionMode, getExecutionModes } from '../../execution-modes';
import { useLogger } from '../../services/logger';

export function EditorArea() {
  const {
    tabs,
    activeTabId,
    setActive,
    closeTab,
    updateContent,
    openTab,
    updateTab,
    bumpScriptsVersion,
    panelSizes,
    setPanelSizes,
  } = useEditorStore();
  const { activeConnectionId, activeDatabase } = useConnectionsStore();
  const startRun = useResultsStore((s) => s.startRun);
  const finishRun = useResultsStore((s) => s.finishRun);
  const setError = useResultsStore((s) => s.setError);
  const active = tabs.find((t) => t.id === activeTabId);
  const completions = useCollectionCompletions(
    active?.connectionId ?? activeConnectionId,
    active?.database ?? activeDatabase,
  );
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const activePageSize = active ? (pageSizes[active.id] ?? 50) : 50;
  const isRunning = useResultsStore((s) => (active ? !!s.byTab[active.id]?.isRunning : false));
  const log = useLogger('components.EditorArea');
  useTabActions();

  const [cursorLines, setCursorLines] = useState<Record<string, number>>({});
  const [selections, setSelections] = useState<Record<string, string | null>>({});
  const lastRunContentRef = useRef<Record<string, string>>({});

  const activeCursorLine = active ? (cursorLines[active.id] ?? 1) : 1;
  const activeSelection = active ? (selections[active.id] ?? null) : null;

  const currentStatement =
    active && active.type === 'script' && !activeSelection
      ? getStatementAtCursor(active.content, activeCursorLine)
      : null;
  const highlightRange = currentStatement
    ? { startLine: currentStatement.startLine, endLine: currentStatement.endLine }
    : null;

  async function executeContent(content: string, page: number, pageSize: number) {
    if (!active || active.type !== 'script') return;
    if (!content) return;
    const connId = active.connectionId ?? activeConnectionId;
    const db = active.database ?? activeDatabase;
    if (!connId || !db) return;
    lastRunContentRef.current[active.id] = content;
    const runId = crypto.randomUUID();
    log.debug('execute requested', {
      runId,
      tabId: active.id,
      connId,
      db,
      page,
      pageSize,
    });
    startRun(active.id, runId);
    try {
      await runScript(active.id, connId, db, content, page, pageSize, runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'cancelled') return;
      log.error('runScript failed', { runId, tabId: active.id, err: msg });
      setError(active.id, msg);
      finishRun(active.id, 0);
    }
  }

  async function handleExecute(modeId: string) {
    const mode = getExecutionMode(modeId);
    if (!mode || !active || active.type !== 'script') return;
    const content = mode.resolveContent({
      content: active.content,
      cursorLine: cursorLines[active.id] ?? 1,
      selection: selections[active.id] ?? null,
    });
    if (content == null) return;
    await executeContent(content, 0, activePageSize);
  }

  async function handlePageChange(page: number, pageSize: number) {
    if (!active) return;
    const last = lastRunContentRef.current[active.id] ?? active.content;
    await executeContent(last, page, pageSize);
  }

  async function handleDocUpdated() {
    if (!active) return;
    const last = lastRunContentRef.current[active.id] ?? active.content;
    await executeContent(last, 0, activePageSize);
  }

  async function handleCancel() {
    if (!active) return;
    await cancelScript(active.id);
    finishRun(active.id, 0);
  }

  async function handleSave(name: string, tags: string) {
    if (!active || active.type !== 'script') return;
    await createScript(name, active.content, tags);
    bumpScriptsVersion();
  }

  function handleNewTab() {
    openTab(newScriptTab());
  }

  function handleCursorChange(line: number) {
    if (!active) return;
    setCursorLines((prev) => (prev[active.id] === line ? prev : { ...prev, [active.id]: line }));
  }

  function handleSelectionChange(text: string | null) {
    if (!active) return;
    setSelections((prev) => (prev[active.id] === text ? prev : { ...prev, [active.id]: text }));
  }

  const activeSizes = (active && panelSizes[active.id]) || DEFAULT_PANEL_SIZES;
  const [editorDefault, resultsDefault] = activeSizes;

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
                background: t.id === activeTabId ? 'var(--accent)' : 'transparent',
                color: t.id === activeTabId ? 'var(--bg)' : 'inherit',
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
          <button onClick={handleNewTab} style={{ margin: '0 6px' }}>
            + New
          </button>
        </div>
        {isRunning && (
          <div style={{ paddingRight: 10 }}>
            <button onClick={handleCancel}>✕ Cancel</button>
          </div>
        )}
      </div>
      {active?.type === 'script' && (
        <ContextBar
          tabId={active.id}
          connectionId={active.connectionId}
          database={active.database}
          onConnectionChange={(id) =>
            updateTab(active.id, { connectionId: id, database: undefined })
          }
          onDatabaseChange={(db) => updateTab(active.id, { database: db })}
          modes={getExecutionModes()}
          onExecute={handleExecute}
          onSave={handleSave}
          isRunning={isRunning}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!active && (
          <div style={{ padding: 20, color: 'var(--fg-dim)' }}>No editor tab open.</div>
        )}
        {active?.type === 'script' && (
          <PanelGroup
            key={active.id}
            direction="vertical"
            onLayout={(sizes) => setPanelSizes(active.id, sizes as [number, number])}
            style={{ flex: 1, minHeight: 0 }}
          >
            <Panel minSize={20} defaultSize={editorDefault}>
              <div style={{ height: '100%' }}>
                <ScriptEditor
                  value={active.content}
                  onChange={(v) => updateContent(active.id, v)}
                  modes={getExecutionModes()}
                  onExecute={handleExecute}
                  onCursorChange={handleCursorChange}
                  onSelectionChange={handleSelectionChange}
                  highlightRange={highlightRange}
                  collections={completions.map((c) => c.name)}
                />
              </div>
            </Panel>
            <SplitHandle direction="vertical" />
            <Panel minSize={20} defaultSize={resultsDefault}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <ResultsPanel
                  tabId={active.id}
                  pageSize={activePageSize}
                  onPageChange={handlePageChange}
                  onPageSizeChange={(size) => setPageSizes((prev) => ({ ...prev, [active.id]: size }))}
                  connectionId={active.connectionId}
                  database={active.database}
                  onDocUpdated={handleDocUpdated}
                />
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>
    </div>
  );
}
