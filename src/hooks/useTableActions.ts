import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useCellSelection } from '../contexts/CellSelectionContext';
import type { SelectedCell } from '../contexts/CellSelectionContext';
import { useKeyboardService } from '../services/KeyboardService';
import type { KeyCombo } from '../services/KeyboardService';

export interface TableActionHandlers {
  onViewRecord?: (doc: Record<string, unknown>) => void;
  onEditRecord?: (doc: Record<string, unknown>) => void;
}

interface TableActionDef {
  id: string;
  keys: KeyCombo;
  label: string;
  showInContextMenu: boolean;
  execute: (selected: SelectedCell | null, handlers: TableActionHandlers) => void;
}

const TABLE_ACTIONS: TableActionDef[] = [
  {
    id: 'cell.copyValue',
    keys: { cmd: true, key: 'c' },
    label: 'Copy Value',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(String(selected.value));
    },
  },
  {
    id: 'cell.copyField',
    keys: { ctrl: true, cmd: true, key: 'c' },
    label: 'Copy Field',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(`"${selected.colKey}": ${JSON.stringify(selected.value)}`);
    },
  },
  {
    id: 'cell.copyFieldPath',
    keys: { shift: true, alt: true, cmd: true, key: 'c' },
    label: 'Copy Field Path',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(selected.colKey);
    },
  },
  {
    id: 'cell.copyDocument',
    keys: { shift: true, cmd: true, key: 'c' },
    label: 'Copy Document',
    showInContextMenu: true,
    execute: (selected) => {
      if (!selected) return;
      navigator.clipboard.writeText(JSON.stringify(selected.doc, null, 2));
    },
  },
  {
    id: 'cell.viewRecord',
    keys: { key: 'F3' },
    label: 'View Full Record',
    showInContextMenu: true,
    execute: (selected, { onViewRecord }) => {
      if (!selected) return;
      onViewRecord?.(selected.doc);
    },
  },
  {
    id: 'cell.editRecord',
    keys: { key: 'F4' },
    label: 'Edit Full Record',
    showInContextMenu: true,
    execute: (selected, { onEditRecord }) => {
      if (!selected) return;
      onEditRecord?.(selected.doc);
    },
  },
];

interface NavActionDef {
  id: string;
  keys: KeyCombo;
  label: string;
  rowDelta: number;
  colDelta: number;
}

const NAV_ACTIONS: NavActionDef[] = [
  { id: 'cell.navigateUp', keys: { key: 'ArrowUp' }, label: 'Navigate Up', rowDelta: -1, colDelta: 0 },
  { id: 'cell.navigateDown', keys: { key: 'ArrowDown' }, label: 'Navigate Down', rowDelta: 1, colDelta: 0 },
  { id: 'cell.navigateLeft', keys: { key: 'ArrowLeft' }, label: 'Navigate Left', rowDelta: 0, colDelta: -1 },
  { id: 'cell.navigateRight', keys: { key: 'ArrowRight' }, label: 'Navigate Right', rowDelta: 0, colDelta: 1 },
];

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
      svc.register({
        id: def.id,
        keys: def.keys,
        label: def.label,
        showInContextMenu: def.showInContextMenu,
        action: () =>
          def.execute(stateRef.current.selected, stateRef.current.handlers),
      })
    );

    const navUnregisters = NAV_ACTIONS.map((def) =>
      svc.register({
        id: def.id,
        keys: def.keys,
        label: def.label,
        showInContextMenu: false,
        action: () => {
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
        },
      })
    );

    return () => {
      unregisters.forEach((fn) => fn());
      navUnregisters.forEach((fn) => fn());
    };
  }, [svc]);
}
