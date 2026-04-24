import { createContext, useContext, useState, type ReactNode } from 'react';

export interface SelectedCell {
  rowIndex: number;
  colKey: string;
  doc: Record<string, unknown>;
  value: unknown;
  /**
   * Index of the ResultGroup this cell belongs to. Enables downstream actions
   * (edit/view) to resolve per-group collection metadata (see
   * useRecordActions + ResultsPanel). Defaults to 0 for single-group results.
   */
  groupIndex: number;
}

interface CellSelectionContextValue {
  selected: SelectedCell | null;
  select: (cell: SelectedCell) => void;
  clear: () => void;
}

const CellSelectionContext = createContext<CellSelectionContextValue | null>(null);

export function CellSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  return (
    <CellSelectionContext.Provider value={{ selected, select: setSelected, clear: () => setSelected(null) }}>
      {children}
    </CellSelectionContext.Provider>
  );
}

export function useCellSelection(): CellSelectionContextValue {
  const ctx = useContext(CellSelectionContext);
  if (!ctx) throw new Error('useCellSelection must be used inside CellSelectionProvider');
  return ctx;
}
