import { useRef, useMemo, useState, useCallback } from 'react';
import { renderCell } from './cellRenderers';
import { useCellSelection } from '../../contexts/CellSelectionContext';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { keyboardService, formatKeyCombo } from '../../services/KeyboardService';

interface Props {
  docs: unknown[];
  sortKey: string | null;
  sortDir: 1 | -1;
  onToggleSort: (colKey: string) => void;
}

export function columnsOf(docs: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of docs) {
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d as Record<string, unknown>)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
  }
  if (out.length === 0 && docs.some((d) => d !== null && typeof d !== 'object')) {
    out.push('value');
  }
  return out;
}

interface ContextMenuState {
  x: number;
  y: number;
}

export function TableView({ docs, sortKey, sortDir, onToggleSort }: Props) {
  const columns = useMemo(() => columnsOf(docs), [docs]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { selected, select, clear } = useCellSelection();

  const handleCellClick = useCallback(
    (rowIndex: number, colKey: string, doc: Record<string, unknown>) => {
      select({ rowIndex, colKey, doc, value: doc[colKey] });
      containerRef.current?.focus();
    },
    [select]
  );

  const handleCellContextMenu = useCallback(
    (e: React.MouseEvent, rowIndex: number, colKey: string, doc: Record<string, unknown>) => {
      e.preventDefault();
      select({ rowIndex, colKey, doc, value: doc[colKey] });
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [select]
  );

  const contextMenuItems: ContextMenuItem[] = keyboardService
    .getShortcuts()
    .filter((s) => s.showInContextMenu)
    .map((s) => ({
      label: s.label,
      shortcutHint: formatKeyCombo(s.keys),
      action: s.action,
      disabled: !selected,
    }));

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{ overflow: 'auto', flex: 1, outline: 'none' }}
      onMouseDown={(e) => {
        if (e.target === containerRef.current) clear();
      }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                onClick={() => onToggleSort(c)}
                style={{
                  borderBottom: '1px solid var(--border)',
                  padding: '4px 8px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: 'var(--bg-panel)',
                  position: 'sticky',
                  top: 0,
                }}
              >
                {c} {sortKey === c ? (sortDir === 1 ? '↑' : '↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map((d, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const doc =
                  d !== null && typeof d === 'object'
                    ? (d as Record<string, unknown>)
                    : { value: d };
                const raw = doc[c];
                const isSelected = selected?.rowIndex === i && selected?.colKey === c;
                return (
                  <td
                    key={c}
                    data-row={i}
                    data-col={c}
                    aria-selected={isSelected}
                    onClick={() => handleCellClick(i, c, doc)}
                    onContextMenu={(e) => handleCellContextMenu(e, i, c, doc)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      outline: isSelected ? '2px solid var(--accent-blue, #3b82f6)' : 'none',
                      outlineOffset: '-2px',
                      background: isSelected ? 'var(--bg-selected, rgba(59,130,246,0.08))' : undefined,
                    }}
                  >
                    {renderCell(raw)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
