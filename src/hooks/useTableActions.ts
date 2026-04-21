import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useCellSelection } from '../contexts/CellSelectionContext';
import type { SelectedCell } from '../contexts/CellSelectionContext';
import { keyboardService, useKeyboardService } from '../services/KeyboardService';
import { DEFAULT_SHORTCUTS } from '../shortcuts/defaults';

export interface TableActionHandlers {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
}

interface TableActionDef {
  id: string;
  execute: (selected: SelectedCell | null, handlers: TableActionHandlers) => void;
}

const TABLE_ACTIONS: TableActionDef[] = [
  {
    id: 'cell.copyValue',
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(String(selected.value));
    },
  },
  {
    id: 'cell.copyField',
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(`"${selected.colKey}": ${JSON.stringify(selected.value)}`);
    },
  },
  {
    id: 'cell.copyFieldPath',
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(selected.colKey);
    },
  },
  {
    id: 'cell.copyDocument',
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(JSON.stringify(selected.doc, null, 2));
    },
  },
  {
    id: 'cell.viewRecord',
    execute: (selected, { onViewRecord }) => {
      if (!selected) return;
      onViewRecord?.(selected.doc);
    },
  },
  {
    id: 'cell.editRecord',
    execute: (selected, { onEditRecord }) => {
      if (!selected) return;
      onEditRecord?.(selected.doc);
    },
  },
];

interface NavActionDef {
  id: string;
  rowDelta: number;
  colDelta: number;
}

const NAV_ACTIONS: NavActionDef[] = [
  { id: 'cell.navigateUp', rowDelta: -1, colDelta: 0 },
  { id: 'cell.navigateDown', rowDelta: 1, colDelta: 0 },
  { id: 'cell.navigateLeft', rowDelta: 0, colDelta: -1 },
  { id: 'cell.navigateRight', rowDelta: 0, colDelta: 1 },
];

const RESULTS_ACTION_IDS = new Set<string>([
  ...TABLE_ACTIONS.map((a) => a.id),
  ...NAV_ACTIONS.map((a) => a.id),
]);
DEFAULT_SHORTCUTS
  .filter((def) => RESULTS_ACTION_IDS.has(def.id))
  .forEach((def) => keyboardService.defineShortcut(def));

export function useTableActions(
  handlers: TableActionHandlers = {},
  docsRef?: MutableRefObject<unknown[]>,
  columnsRef?: MutableRefObject<string[]>,
): void {
  const svc = useKeyboardService();
  const { selected, select } = useCellSelection();
  const stateRef = useRef({ selected, handlers, select, docsRef, columnsRef });
  stateRef.current = { selected, handlers, select, docsRef, columnsRef };

  useEffect(() => {
    const unregisters = TABLE_ACTIONS.map((def) =>
      svc.register(def.id, () =>
        def.execute(stateRef.current.selected, stateRef.current.handlers),
      ),
    );

    const navUnregisters = NAV_ACTIONS.map((def) =>
      svc.register(def.id, () => {
        const { selected: sel, docsRef: dRef, columnsRef: cRef, select: selectFn } = stateRef.current;
        if (!sel || !dRef || !cRef) return;
        const docs = dRef.current;
        const cols = cRef.current;
        if (docs.length === 0 || cols.length === 0) return;
        const nextRow = Math.max(0, Math.min(docs.length - 1, sel.rowIndex + def.rowDelta));
        const curColIdx = cols.indexOf(sel.colKey);
        const nextColIdx = Math.max(0, Math.min(cols.length - 1, curColIdx + def.colDelta));
        const nextColKey = cols[nextColIdx];
        const rawRow = docs[nextRow];
        if (rawRow === undefined) return;
        const nextDoc: Record<string, unknown> =
          rawRow !== null && typeof rawRow === 'object'
            ? (rawRow as Record<string, unknown>)
            : { value: rawRow };
        const nextValue = nextDoc[nextColKey];
        selectFn({ rowIndex: nextRow, colKey: nextColKey, doc: nextDoc, value: nextValue });
        document
          .querySelector(`[data-row="${nextRow}"][data-col="${nextColKey}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }),
    );

    return () => {
      unregisters.forEach((fn) => fn());
      navUnregisters.forEach((fn) => fn());
    };
  }, [svc]);
}
