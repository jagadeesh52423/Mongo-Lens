import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useResultsStore } from '../../../store/results';
import { RecordModalShell } from './RecordModalShell';
import { toCsv, toJsonText } from '../../../utils/export';
import { CellSelectionProvider, useCellSelection } from '../../../contexts/CellSelectionContext';
import { useRecordActions } from '../../../hooks/useRecordActions';
import { KeyboardScopeZone } from '../../shared/KeyboardScopeZone';
import type { RecordContext } from '../../../services/records/RecordContext';
import type { RecordActionHost } from '../../../services/records/RecordActionHost';
import type { ResultGroup } from '../../../types';
import { ErrorBanner } from './ErrorBanner';
import { ResultsToolbar } from './ResultsToolbar';
import { ResultsPagination } from './ResultsPagination';
import { ConsolePanel } from './ConsolePanel';
import { GroupTabs } from './GroupTabs';
import { viewModeRegistry } from './viewModes';
import { useResultsHost } from './useResultsHost';
import styles from './ResultsPanel.module.css';

function RecordActionsRegistrar({
  context,
  host,
  activeContextRef,
  docsRef,
  columnsRef,
  groupsRef,
}: {
  context: RecordContext;
  host: RecordActionHost;
  activeContextRef: MutableRefObject<RecordContext>;
  docsRef: MutableRefObject<unknown[]>;
  columnsRef: MutableRefObject<string[]>;
  groupsRef: MutableRefObject<ResultGroup[]>;
}) {
  useRecordActions(context, host, activeContextRef, docsRef, columnsRef, groupsRef);
  return null;
}

function SelectionClearer({ tabId, isRunning }: { tabId: string; isRunning: boolean }) {
  const { clear } = useCellSelection();
  useEffect(() => { clear(); }, [tabId, isRunning]);
  return null;
}

interface Props {
  tabId: string;
  pageSize: number;
  onPageChange?: (page: number, pageSize: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  connectionId?: string;
  database?: string;
  onDocUpdated?: () => void;
}

export function ResultsPanel({
  tabId, pageSize, onPageChange, onPageSizeChange,
  connectionId, database, onDocUpdated,
}: Props) {
  const res = useResultsStore((s) => s.byTab[tabId]);
  const [view, setView] = useState<string>('table');

  const pagination = res?.pagination;
  const groupCount = res?.groups.length ?? 0;
  const logs = res?.logs ?? [];
  const runId = res?.runId;

  // Active selection is either a query-group index or the synthetic 'console'
  // tab that surfaces print() output. 'console' is opt-in and never auto-
  // selected so existing query workflows are unaffected.
  const [activeGroupIndex, setActiveGroupIndex] = useState<number | 'console'>(0);
  // Reset to first tab only when a new run starts (tabId or runId change),
  // not on every streaming group append.
  useEffect(() => { setActiveGroupIndex(0); }, [tabId, runId]);
  const isConsoleActive = activeGroupIndex === 'console';
  const safeActiveIndex =
    typeof activeGroupIndex === 'number' && activeGroupIndex < groupCount
      ? activeGroupIndex
      : 0;
  const activeGroup = res?.groups[safeActiveIndex];

  // Collection + category come exclusively from the active result group's
  // runtime-resolved metadata (QueryTypeRegistry classification). No fallback
  // to tab-creation-time provenance: if the classifier couldn't extract a
  // collection, F4 must stay disabled. Category gates availability of actions
  // like F4 (see editRecordAction.canExecute).
  const recordContext = useMemo<RecordContext>(
    () => ({
      doc: {},
      connectionId,
      database,
      collection: activeGroup?.collection,
      category: activeGroup?.category,
    }),
    [connectionId, database, activeGroup?.collection, activeGroup?.category],
  );

  const { modal, setModal, host, activeContextRef } = useResultsHost({ recordContext, onDocUpdated });

  // `allDocs` powers the toolbar status text and CSV/JSON export — both want
  // the group's docs as a whole, not the per-view (potentially sorted/filtered)
  // slice. Record-action keyboard navigation uses a separate channel: the
  // active view publishes its display-order docs via onRenderedDocsChange
  // (see ViewModeRegistry navigation contract).
  const allDocs = useMemo(() => activeGroup?.docs ?? [], [activeGroup]);

  // Refs surface live state to the record-action keyboard handlers. docsRef
  // and columnsRef are written by the active view via onRenderedDocsChange
  // so F3/↑/↓ follow the user-visible display order.
  const docsRef = useRef<unknown[]>(allDocs);
  const columnsRef = useRef<string[]>([]);
  const groupsRef = useRef<ResultGroup[]>(res?.groups ?? []);
  useEffect(() => { groupsRef.current = res?.groups ?? []; }, [res?.groups]);

  // Stable callback so views' useEffect dependency arrays don't churn.
  const handleRenderedDocsChange = useCallback((docs: unknown[], cols: string[]) => {
    docsRef.current = docs;
    columnsRef.current = cols;
  }, []);

  // After a run completes with results, focus the results scope zone so F3/F4
  // work even when the editor previously had focus. Shortcut dispatch matches
  // strictly against the focused element's scope chain (no sticky fallback).
  const resultsScopeRef = useRef<HTMLDivElement>(null);
  const prevIsRunningRef = useRef(false);
  const isRunning = !!res?.isRunning;
  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning && allDocs.length > 0 && view === 'table') {
      resultsScopeRef.current?.focus();
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning, allDocs.length, view]);

  const handleExport = useCallback(async (kind: 'csv' | 'json') => {
    const suggested = kind === 'csv' ? 'results.csv' : 'results.json';
    const path = await saveDialog({ defaultPath: suggested });
    if (!path) return;
    const content = kind === 'csv' ? toCsv(allDocs) : toJsonText(allDocs);
    await writeTextFile(path as string, content);
  }, [allDocs]);

  const statusText = useMemo(() => {
    if (!res) return '';
    if (res.isRunning) return 'Running…';
    const ms = res.executionMs ?? 0;
    if (pagination && pagination.total >= 0 && allDocs.length > 0) {
      const startIndex = pagination.page * pageSize + 1;
      const endIndex = startIndex + allDocs.length - 1;
      return `${startIndex} - ${endIndex} / ${pagination.total} docs · ${ms} ms`;
    }
    return `${allDocs.length} docs · ${ms} ms`;
  }, [res, pagination, pageSize, allDocs.length]);

  const isEmpty = !res || (
    res.groups.length === 0 && logs.length === 0 && !res.isRunning && !res.lastError && !res.pagination
  );

  return (
    <CellSelectionProvider>
      {!isEmpty && <SelectionClearer tabId={tabId} isRunning={!!res?.isRunning} />}
      <RecordActionsRegistrar
        context={recordContext}
        host={host}
        activeContextRef={activeContextRef}
        docsRef={docsRef}
        columnsRef={columnsRef}
        groupsRef={groupsRef}
      />
      {isEmpty ? (
        <KeyboardScopeZone scope="results">
          <div className={styles.empty}>Run a script to see results.</div>
        </KeyboardScopeZone>
      ) : (
        <KeyboardScopeZone
          ref={resultsScopeRef}
          scope="results"
          tabIndex={-1}
          style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none' }}
        >
          <ResultsToolbar
            view={view}
            onChangeView={setView}
            onExportCsv={() => handleExport('csv')}
            onExportJson={() => handleExport('json')}
            exportDisabled={allDocs.length === 0}
            statusText={statusText}
          />
          <GroupTabs
            groupCount={groupCount}
            logsCount={logs.length}
            active={activeGroupIndex}
            onChange={setActiveGroupIndex}
          />
          {res!.lastError && <ErrorBanner message={res!.lastError} />}
          <div className={styles.body}>
            {isConsoleActive ? (
              <ConsolePanel logs={logs} />
            ) : activeGroup ? (
              (() => {
                const ViewComponent = viewModeRegistry.get(view)?.Component;
                if (!ViewComponent) return null;
                return (
                  <ViewComponent
                    group={activeGroup}
                    onRenderedDocsChange={handleRenderedDocsChange}
                  />
                );
              })()
            ) : null}
          </div>
          {pagination && (
            <ResultsPagination
              page={pagination.page}
              pageSize={pageSize}
              total={pagination.total}
              busy={!!res?.isRunning}
              onPageChange={(p, ps) => onPageChange?.(p, ps)}
              onPageSizeChange={(ps) => onPageSizeChange?.(ps)}
            />
          )}
        </KeyboardScopeZone>
      )}
      {modal && (
        <RecordModalShell
          title={modal.title}
          body={modal.body}
          footer={modal.footer}
          onClose={() => setModal(null)}
          beforeClose={modal.beforeClose}
        />
      )}
    </CellSelectionProvider>
  );
}
