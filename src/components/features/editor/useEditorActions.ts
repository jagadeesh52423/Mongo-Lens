import { useRef, useState } from 'react';
import { runScript, cancelScript, createScript, updateScript } from '../../../ipc';
import { useConnectionsStore } from '../../../store/connections';
import { useEditorStore } from '../../../store/editor';
import { useResultsStore } from '../../../store/results';
import { useLogger } from '../../../services/logger';
import { getExecutionMode } from '../../../execution-modes';
import type { EditorTab } from '../../../types';

/**
 * Owns the active tab's run / page / save handlers and the per-tab cursor +
 * page-size state. Extracted from EditorArea to keep that component focused
 * on layout. All handlers are no-ops when `active` is null.
 */
export function useEditorActions(active: EditorTab | undefined) {
  const { activeConnectionId, activeDatabase } = useConnectionsStore();
  const { updateTab, bumpScriptsVersion, selections } = useEditorStore();
  const startRun = useResultsStore((s) => s.startRun);
  const finishRun = useResultsStore((s) => s.finishRun);
  const setError = useResultsStore((s) => s.setError);
  const log = useLogger('components.EditorArea');

  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const [cursorLines, setCursorLines] = useState<Record<string, number>>({});
  const lastRunContentRef = useRef<Record<string, string>>({});

  const activePageSize = active ? (pageSizes[active.id] ?? 50) : 50;

  async function executeContent(content: string, page: number, pageSize: number) {
    if (!active || active.type !== 'script' || !content) return;
    const connId = active.connectionId ?? activeConnectionId;
    const db = active.database ?? activeDatabase;
    if (!connId || !db) return;
    lastRunContentRef.current[active.id] = content;
    const runId = crypto.randomUUID();
    log.debug('execute requested', { runId, tabId: active.id, connId, db, page, pageSize });
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
      // Execution modes only care about the selected text, not its range.
      selection: selections[active.id]?.text ?? null,
    });
    if (content == null) return;
    await executeContent(content, 0, activePageSize);
  }

  async function handlePageChange(page: number, pageSize: number) {
    if (!active) return;
    await executeContent(lastRunContentRef.current[active.id] ?? active.content, page, pageSize);
  }

  async function handleDocUpdated() {
    if (!active) return;
    await executeContent(lastRunContentRef.current[active.id] ?? active.content, 0, activePageSize);
  }

  async function handleCancel() {
    if (!active) return;
    await cancelScript(active.id);
    finishRun(active.id, 0);
  }

  async function handleSave() {
    if (!active || active.type !== 'script' || !active.savedScriptId) return;
    try {
      const updated = await updateScript(
        active.savedScriptId, active.title, active.content,
        active.savedScriptTags ?? '', active.connectionId,
      );
      updateTab(active.id, { isDirty: false, savedScriptTags: updated.tags });
      bumpScriptsVersion();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to save: ${msg}\n\nTry "Save As" to create a new script instead.`);
    }
  }

  async function handleSaveAs(name: string, tags: string) {
    if (!active || active.type !== 'script') return;
    const created = await createScript(name, active.content, tags, active.connectionId);
    updateTab(active.id, {
      title: name,
      savedScriptId: created.id,
      savedScriptTags: created.tags,
      isDirty: false,
    });
    bumpScriptsVersion();
  }

  function setActivePageSize(size: number) {
    if (!active) return;
    setPageSizes((prev) => ({ ...prev, [active.id]: size }));
  }

  function setActiveCursorLine(line: number) {
    if (!active) return;
    setCursorLines((prev) => (prev[active.id] === line ? prev : { ...prev, [active.id]: line }));
  }

  return {
    activePageSize,
    cursorLines,
    handleExecute,
    handlePageChange,
    handleDocUpdated,
    handleCancel,
    handleSave,
    handleSaveAs,
    setActivePageSize,
    setActiveCursorLine,
  };
}
