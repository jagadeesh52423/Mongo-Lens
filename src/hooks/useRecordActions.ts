import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useCellSelection } from '../contexts/CellSelectionContext';
import type { SelectedCell } from '../contexts/CellSelectionContext';
import { keyboardService, useKeyboardService } from '../services/KeyboardService';
import { DEFAULT_SHORTCUTS } from '../shortcuts/defaults';
import { recordActionRegistry } from '../services/records/RecordActionRegistry';
import type { RecordContext } from '../services/records/RecordContext';
import type { RecordActionHost } from '../services/records/RecordActionHost';
import type { ResultGroup } from '../types';
// side-effect imports — register built-in actions with the registry at module load
import '../services/records/actions/viewRecordAction';
import '../services/records/actions/editRecordAction';

interface CopyActionDef {
  id: string;
  execute: (selected: SelectedCell) => void;
}

const COPY_ACTIONS: CopyActionDef[] = [
  {
    id: 'cell.copyValue',
    execute: (selected) => {
      navigator.clipboard.writeText(String(selected.value));
    },
  },
  {
    id: 'cell.copyField',
    execute: (selected) => {
      navigator.clipboard.writeText(`"${selected.colKey}": ${JSON.stringify(selected.value)}`);
    },
  },
  {
    id: 'cell.copyFieldPath',
    execute: (selected) => {
      navigator.clipboard.writeText(selected.colKey);
    },
  },
  {
    id: 'cell.copyDocument',
    execute: (selected) => {
      navigator.clipboard.writeText(JSON.stringify(selected.doc, null, 2));
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

// Define copy + nav shortcuts from defaults.ts (record actions self-register via registry).
const HOOK_OWNED_IDS = new Set<string>([
  ...COPY_ACTIONS.map((a) => a.id),
  ...NAV_ACTIONS.map((a) => a.id),
]);
DEFAULT_SHORTCUTS
  .filter((def) => HOOK_OWNED_IDS.has(def.id))
  .forEach((def) => keyboardService.defineShortcut(def));

export function useRecordActions(
  context: RecordContext,
  host: RecordActionHost,
  activeContextRef?: MutableRefObject<RecordContext>,
  docsRef?: MutableRefObject<unknown[]>,
  columnsRef?: MutableRefObject<string[]>,
  /**
   * Optional ref to the current ResultGroup[]. When provided, record actions
   * resolve the target collection from the group matching selected.groupIndex
   * instead of using the static collection on `context`. This lets F4/F3
   * availability derive from per-group query metadata (see QueryTypeRegistry).
   */
  groupsRef?: MutableRefObject<ResultGroup[]>,
): void {
  const svc = useKeyboardService();
  const { selected, select } = useCellSelection();
  const stateRef = useRef({ selected, context, host, select, docsRef, columnsRef, activeContextRef, groupsRef });
  stateRef.current = { selected, context, host, select, docsRef, columnsRef, activeContextRef, groupsRef };

  useEffect(() => {
    const copyUnregisters = COPY_ACTIONS.map((def) =>
      svc.register(def.id, () => {
        const { selected: sel } = stateRef.current;
        if (!sel) return;
        def.execute(sel);
      }),
    );

    const recordActions = recordActionRegistry.getAll().filter((a) => a.keyBinding);
    const recordUnregisters = recordActions.map((action) =>
      svc.register(action.id, () => {
        const {
          selected: sel,
          context: ctx,
          host: h,
          activeContextRef: ctxRef,
          docsRef: dRef,
          columnsRef: cRef,
          groupsRef: gRef,
        } = stateRef.current;
        let effectiveSel = sel;
        if (!effectiveSel && dRef?.current.length && cRef?.current.length) {
          const rawDoc = dRef.current[0];
          const doc = rawDoc !== null && typeof rawDoc === 'object'
            ? (rawDoc as Record<string, unknown>)
            : { value: rawDoc };
          effectiveSel = { rowIndex: 0, colKey: cRef.current[0], doc, value: doc[cRef.current[0]], groupIndex: 0 };
        }
        if (!effectiveSel) return;
        // Resolve collection + category exclusively from the ResultGroup the
        // selected cell belongs to. No fallback to ctx.collection — if the
        // classifier couldn't resolve a target collection for this group,
        // canExecute must see `undefined` so category-sensitive actions (F4)
        // stay disabled. Falling back would defeat the point of per-group
        // classification (see QueryTypeRegistry + editRecordAction.canExecute).
        const group = gRef?.current?.[effectiveSel.groupIndex];
        const ctx2: RecordContext = {
          ...ctx,
          doc: effectiveSel.doc,
          collection: group?.collection,
          category: group?.category,
        };
        if (action.canExecute(ctx2)) {
          if (ctxRef) ctxRef.current = ctx2;
          action.execute(ctx2, h);
        }
      }),
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
        selectFn({ rowIndex: nextRow, colKey: nextColKey, doc: nextDoc, value: nextValue, groupIndex: sel.groupIndex });
        document
          .querySelector(`[data-row="${nextRow}"][data-col="${nextColKey}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }),
    );

    return () => {
      copyUnregisters.forEach((fn) => fn());
      recordUnregisters.forEach((fn) => fn());
      navUnregisters.forEach((fn) => fn());
    };
  }, [svc]);
}
