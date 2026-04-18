import { useEffect, useRef } from 'react';
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

export function useTableActions(handlers: TableActionHandlers = {}): void {
  const svc = useKeyboardService();
  const { selected } = useCellSelection();
  const stateRef = useRef({ selected, handlers });
  stateRef.current = { selected, handlers };

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
    return () => unregisters.forEach((fn) => fn());
  }, [svc]);
}
