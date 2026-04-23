import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useResultsStore } from '../../store/results';
import { JsonView } from './JsonView';
import { TableView, columnsOf } from './TableView';
import { RecordModalShell } from './RecordModalShell';
import { toCsv, toJsonText } from '../../utils/export';
import { CellSelectionProvider, useCellSelection } from '../../contexts/CellSelectionContext';
import { useRecordActions } from '../../hooks/useRecordActions';
import { KeyboardScopeZone } from '../shared/KeyboardScopeZone';
import { recordActionRegistry } from '../../services/records/RecordActionRegistry';
import type { RecordContext } from '../../services/records/RecordContext';
import type { RecordActionHost } from '../../services/records/RecordActionHost';

interface ModalState {
  title: string;
  body: ReactNode;
  footer: ReactNode;
}

function RecordActionsRegistrar({
  context,
  host,
  activeContextRef,
  docsRef,
  columnsRef,
}: {
  context: RecordContext;
  host: RecordActionHost;
  activeContextRef: MutableRefObject<RecordContext>;
  docsRef: MutableRefObject<unknown[]>;
  columnsRef: MutableRefObject<string[]>;
}) {
  useRecordActions(context, host, activeContextRef, docsRef, columnsRef);
  return null;
}

function SelectionClearer({ tabId, isRunning }: { tabId: string; isRunning: boolean }) {
  const { clear } = useCellSelection();
  useEffect(() => { clear(); }, [tabId, isRunning]);
  return null;
}

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 200] as const;

interface Props {
  tabId: string;
  pageSize: number;
  onPageChange?: (page: number, pageSize: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  connectionId?: string;
  database?: string;
  collection?: string;
  onDocUpdated?: () => void;
}

export function ResultsPanel({
  tabId, pageSize, onPageChange, onPageSizeChange,
  connectionId, database, collection, onDocUpdated,
}: Props) {
  const res = useResultsStore((s) => s.byTab[tabId]);
  const [view, setView] = useState<'json' | 'table'>('table');
  const [modal, setModal] = useState<ModalState | null>(null);
  const onDocUpdatedRef = useRef(onDocUpdated);
  onDocUpdatedRef.current = onDocUpdated;

  const recordContext = useMemo<RecordContext>(
    () => ({ doc: {}, connectionId, database, collection }),
    [connectionId, database, collection],
  );

  // Tracks the context of the currently-active action so executeAction (e.g., view → edit handoff)
  // can re-dispatch with the same doc without the caller threading it through.
  const activeContextRef = useRef<RecordContext>(recordContext);

  const host = useMemo<RecordActionHost>(() => {
    const h: RecordActionHost = {
      openModal(title, body, footer) {
        setModal({ title, body, footer });
      },
      close() {
        setModal(null);
      },
      triggerDocUpdate() {
        onDocUpdatedRef.current?.();
      },
      executeAction(id) {
        const action = recordActionRegistry.getById(id);
        if (!action) return;
        const ctx = activeContextRef.current;
        if (!action.canExecute(ctx)) return;
        action.execute(ctx, h);
      },
    };
    return h;
  }, []);

  const pagination = res?.pagination;
  const totalPages = pagination && pagination.total >= 0
    ? Math.max(1, Math.ceil(pagination.total / pageSize))
    : -1;

  // 1-indexed input synced to pagination.page
  const [inputPage, setInputPage] = useState(1);
  useEffect(() => {
    if (pagination) setInputPage(pagination.page + 1);
  }, [pagination?.page]);

  const groupCount = res?.groups.length ?? 0;
  const runId = res?.runId;
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  // Reset to first tab only when a new run starts (tabId or runId change),
  // not on every streaming group append.
  useEffect(() => { setActiveGroupIndex(0); }, [tabId, runId]);
  const safeActiveIndex = activeGroupIndex < groupCount ? activeGroupIndex : 0;

  const allDocs = useMemo(() => {
    if (!res) return [];
    const group = res.groups[safeActiveIndex];
    return group ? group.docs : [];
  }, [res, safeActiveIndex]);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  // Reset sort when switching tabs (across script tabs or between queries).
  useEffect(() => { setSortKey(null); setSortDir(1); }, [tabId, safeActiveIndex]);

  const sortedDocs = useMemo(() => {
    if (!sortKey) return allDocs;
    const arr = [...allDocs];
    arr.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] as unknown;
      const bv = (b as Record<string, unknown>)[sortKey] as unknown;
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return String(av) < String(bv) ? -sortDir : sortDir;
    });
    return arr;
  }, [allDocs, sortKey, sortDir]);

  const handleToggleSort = useCallback((colKey: string) => {
    setSortKey((prevKey) => {
      if (prevKey === colKey) {
        setSortDir((d) => (d === 1 ? -1 : 1));
        return prevKey;
      }
      setSortDir(1);
      return colKey;
    });
  }, []);

  const columns = useMemo(() => columnsOf(sortedDocs), [sortedDocs]);

  const docsRef = useRef<unknown[]>(sortedDocs);
  const columnsRef = useRef<string[]>(columns);
  useEffect(() => { docsRef.current = sortedDocs; }, [sortedDocs]);
  useEffect(() => { columnsRef.current = columns; }, [columns]);

  const resultsScopeRef = useRef<HTMLDivElement>(null);
  const prevIsRunningRef = useRef(false);
  const isRunning = !!res?.isRunning;
  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning && allDocs.length > 0 && view === 'table') {
      resultsScopeRef.current?.focus();
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning, allDocs.length, view]);

  async function exportAs(kind: 'csv' | 'json') {
    const suggested = kind === 'csv' ? 'results.csv' : 'results.json';
    const path = await saveDialog({ defaultPath: suggested });
    if (!path) return;
    const content = kind === 'csv' ? toCsv(allDocs) : toJsonText(allDocs);
    await writeTextFile(path as string, content);
  }

  function handlePageInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const parsed = parseInt(String(inputPage), 10);
    if (isNaN(parsed)) return;
    const clamped = Math.max(1, totalPages > 0 ? Math.min(parsed, totalPages) : parsed);
    setInputPage(clamped);
    onPageChange?.(clamped - 1, pageSize); // convert to 0-indexed
  }

  if (!res || (res.groups.length === 0 && !res.isRunning && !res.lastError && !res.pagination)) {
    return (
      <CellSelectionProvider>
        <RecordActionsRegistrar
          context={recordContext}
          host={host}
          activeContextRef={activeContextRef}
          docsRef={docsRef}
          columnsRef={columnsRef}
        />
        <KeyboardScopeZone scope="results">
          <div style={{ padding: 12, color: 'var(--fg-dim)' }}>
            Run a script to see results.
          </div>
        </KeyboardScopeZone>
        {modal && (
          <RecordModalShell
            title={modal.title}
            body={modal.body}
            footer={modal.footer}
            onClose={() => setModal(null)}
          />
        )}
      </CellSelectionProvider>
    );
  }

  return (
    <CellSelectionProvider>
      <SelectionClearer tabId={tabId} isRunning={!!res?.isRunning} />
      <RecordActionsRegistrar
        context={recordContext}
        host={host}
        activeContextRef={activeContextRef}
        docsRef={docsRef}
        columnsRef={columnsRef}
      />
      <KeyboardScopeZone ref={resultsScopeRef} scope="results" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none' }}>
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
      {groupCount > 1 && (
        <div
          role="tablist"
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 0,
            padding: '0 8px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-panel)',
            overflowX: 'auto',
          }}
        >
          {res.groups.map((_, idx) => {
            const isActive = idx === safeActiveIndex;
            return (
              <button
                key={idx}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveGroupIndex(idx)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--accent)' : 'var(--fg-dim)',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Query {idx + 1}
              </button>
            );
          })}
        </div>
      )}
      {res.lastError && (
        <div style={{ padding: 8, color: 'var(--accent-red)', fontFamily: 'var(--font-mono)' }}>
          {res.lastError}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'json' ? (
          <JsonView docs={allDocs} />
        ) : (
          <KeyboardScopeZone scope="results-table" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <TableView
              docs={sortedDocs}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={handleToggleSort}
            />
          </KeyboardScopeZone>
        )}
      </div>
      {pagination && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 8px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-panel)',
            fontSize: 12,
          }}
        >
          <button
            aria-label="Prev page"
            onClick={() => onPageChange?.(pagination.page - 1, pageSize)}
            disabled={pagination.page === 0 || res.isRunning}
          >
            ← Prev
          </button>
          <span>Page</span>
          <input
            type="number"
            value={inputPage}
            min={1}
            max={totalPages > 0 ? totalPages : undefined}
            onChange={(e) => setInputPage(Number(e.target.value))}
            onKeyDown={handlePageInputKey}
            style={{ width: 48, textAlign: 'center' }}
          />
          <span>
            of {totalPages > 0 ? totalPages : '?'}
          </span>
          <button
            aria-label="Next page"
            onClick={() => onPageChange?.(pagination.page + 1, pageSize)}
            disabled={(totalPages > 0 && pagination.page >= totalPages - 1) || res.isRunning}
          >
            Next →
          </button>
          <select
            value={pageSize}
            onChange={(e) => {
              const next = Number(e.target.value);
              onPageSizeChange?.(next);
              onPageChange?.(0, next);
            }}
            disabled={res.isRunning}
            style={{ marginLeft: 'auto' }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>per page</span>
        </div>
      )}
    </KeyboardScopeZone>
    {modal && (
      <RecordModalShell
        title={modal.title}
        body={modal.body}
        footer={modal.footer}
        onClose={() => setModal(null)}
      />
    )}
    </CellSelectionProvider>
  );
}
