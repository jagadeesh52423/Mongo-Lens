import { useEffect, useRef } from 'react';
import { Panel, PanelGroup } from 'react-resizable-panels';
import { loader } from '@monaco-editor/react';
import { modelPathForTab, ScriptEditor } from './ScriptEditor';
import { useEditorStore, DEFAULT_PANEL_SIZES } from '../../../store/editor';
import { useConnectionsStore } from '../../../store/connections';
import { ContextBar } from './ContextBar';
import { EditorTabBar } from './EditorTabBar';
import { ResultsPanel } from '../results/ResultsPanel';
import { useCollectionCompletions } from '../../../hooks/useCollectionCompletions';
import { SplitHandle } from '../../shared/SplitHandle';
import { useTabActions } from '../../../hooks/useTabActions';
import { newScriptTab } from '../../../utils/newScriptTab';
import { getStatementAtCursor } from '../../../utils/statementDetection';
import { getExecutionModes } from '../../../execution-modes';
import { useEditorActions } from './useEditorActions';
import { useResultsStore } from '../../../store/results';
import type { EditorSelection } from '../../../types';
import styles from './EditorArea.module.css';

export function EditorArea() {
  const {
    tabs, activeTabId, setActive, closeTab, updateContent, openTab, updateTab,
    panelSizes, setPanelSizes, selections, setSelection,
  } = useEditorStore();
  const { activeConnectionId, activeDatabase } = useConnectionsStore();
  const active = tabs.find((t) => t.id === activeTabId);
  const completions = useCollectionCompletions(
    active?.connectionId ?? activeConnectionId,
    active?.database ?? activeDatabase,
  );
  const isRunning = useResultsStore((s) => (active ? !!s.byTab[active.id]?.isRunning : false));
  useTabActions();

  const actions = useEditorActions(active);
  const {
    activePageSize, cursorLines, handleExecute, handlePageChange, handleDocUpdated,
    handleCancel, handleSave, handleSaveAs, setActivePageSize, setActiveCursorLine,
  } = actions;

  // Dispose Monaco models for tabs that were just removed (prevents leaks).
  const prevTabIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(tabs.map((t) => t.id));
    const removed: string[] = [];
    prevTabIdsRef.current.forEach((id) => { if (!current.has(id)) removed.push(id); });
    prevTabIdsRef.current = current;
    if (removed.length === 0) return;
    const monaco = loader.__getMonacoInstance();
    if (!monaco) return;
    for (const id of removed) {
      const uri = monaco.Uri.parse(modelPathForTab(id));
      monaco.editor.getModel(uri)?.dispose();
    }
  }, [tabs]);

  const activeCursorLine = active ? (cursorLines[active.id] ?? 1) : 1;
  const activeSelection = active ? (selections[active.id] ?? null) : null;
  const currentStatement =
    active && active.type === 'script' && !activeSelection
      ? getStatementAtCursor(active.content, activeCursorLine)
      : null;
  const highlightRange = currentStatement
    ? { startLine: currentStatement.startLine, endLine: currentStatement.endLine }
    : null;

  function handleSelectionChange(selection: EditorSelection | null) {
    if (active) setSelection(active.id, selection);
  }

  const activeSizes = (active && panelSizes[active.id]) || DEFAULT_PANEL_SIZES;
  const [editorDefault, resultsDefault] = activeSizes;

  return (
    <div className={styles.root}>
      <EditorTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        isRunning={isRunning}
        onSelect={setActive}
        onClose={closeTab}
        onNewTab={() => openTab(newScriptTab())}
        onCancel={handleCancel}
      />
      {active?.type === 'script' && (
        <ContextBar
          tabId={active.id}
          connectionId={active.connectionId}
          database={active.database}
          onConnectionChange={(id) => updateTab(active.id, { connectionId: id, database: undefined })}
          onDatabaseChange={(db) => updateTab(active.id, { database: db })}
          modes={getExecutionModes()}
          onExecute={handleExecute}
          onSave={handleSave}
          onSaveAs={handleSaveAs}
          hasSavedScript={!!active.savedScriptId}
          isRunning={isRunning}
        />
      )}
      <div className={styles.body}>
        {!active && <div className={styles.empty}>No editor tab open.</div>}
        {active?.type === 'script' && (
          <PanelGroup
            key={active.id}
            direction="vertical"
            onLayout={(sizes) => setPanelSizes(active.id, sizes as [number, number])}
            className={styles.panelGroup}
          >
            <Panel minSize={20} defaultSize={editorDefault}>
              <div className={styles.scriptHost}>
                <ScriptEditor
                  tabId={active.id}
                  value={active.content}
                  onChange={(v) => updateContent(active.id, v)}
                  modes={getExecutionModes()}
                  onExecute={handleExecute}
                  onCursorChange={setActiveCursorLine}
                  onSelectionChange={handleSelectionChange}
                  highlightRange={highlightRange}
                  collections={completions.map((c) => c.name)}
                />
              </div>
            </Panel>
            <SplitHandle direction="vertical" />
            <Panel minSize={20} defaultSize={resultsDefault}>
              <div className={styles.resultsHost}>
                <ResultsPanel
                  tabId={active.id}
                  pageSize={activePageSize}
                  onPageChange={handlePageChange}
                  onPageSizeChange={setActivePageSize}
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
