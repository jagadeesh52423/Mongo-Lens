import { useCallback, useEffect, useMemo, useState } from 'react';
import { TableView, columnsOf } from '../TableView';
import { KeyboardScopeZone } from '../../../shared/KeyboardScopeZone';
import type { ResultViewMode } from './ViewModeRegistry';

/** Table view strategy. Sort state lives here so ResultsPanel stays view-agnostic. */
function TableViewModeComponent({
  group,
  onRenderedDocsChange,
}: Parameters<ResultViewMode['Component']>[0]) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  // Reset sort when switching to a different result group.
  useEffect(() => {
    setSortKey(null);
    setSortDir(1);
  }, [group.groupIndex]);

  const handleToggleSort = useCallback((colKey: string) => {
    setSortKey((prevKey) => {
      if (prevKey === colKey) {
        setSortDir((dir) => (dir === 1 ? -1 : 1));
        return prevKey;
      }
      setSortDir(1);
      return colKey;
    });
  }, []);

  const sortedDocs = useMemo(
    () => sortDocs(group.docs, sortKey, sortDir),
    [group.docs, sortKey, sortDir],
  );
  const renderedColumns = useMemo(() => columnsOf(sortedDocs), [sortedDocs]);

  // Publish display-order docs/columns to the host so record-action keyboard
  // navigation (F3/↑/↓) follows what the user actually sees.
  useEffect(() => {
    onRenderedDocsChange?.(sortedDocs, renderedColumns);
  }, [sortedDocs, renderedColumns, onRenderedDocsChange]);

  return (
    <KeyboardScopeZone scope="results-table" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <TableView
        docs={sortedDocs}
        sortKey={sortKey}
        sortDir={sortDir}
        onToggleSort={handleToggleSort}
        groupIndex={group.groupIndex}
      />
    </KeyboardScopeZone>
  );
}

function sortDocs(docs: unknown[], key: string | null, dir: 1 | -1): unknown[] {
  if (!key) return docs;
  const arr = [...docs];
  arr.sort((a, b) => {
    const av = (a as Record<string, unknown>)[key] as unknown;
    const bv = (b as Record<string, unknown>)[key] as unknown;
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return String(av) < String(bv) ? -dir : dir;
  });
  return arr;
}

export const TableViewMode: ResultViewMode = {
  id: 'table',
  label: 'Table',
  Component: TableViewModeComponent,
};
