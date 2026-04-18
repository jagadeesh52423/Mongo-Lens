import { useRef, useMemo, useState, useCallback } from 'react';
import { InlineCell } from './InlineCell';
import { renderCell, cellEditString } from './cellRenderers';
import { useCellSelection } from '../../contexts/CellSelectionContext';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { keyboardService, formatKeyCombo } from '../../services/KeyboardService';

interface Props {
  docs: unknown[];
  onEditCell?: (rowIdx: number, key: string, newValue: string) => void;
  onDelete?: (rowIdx: number) => void;
}

function columnsOf(docs: unknown[]): string[] {
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
  return out;
}

interface ContextMenuState {
  x: number;
  y: number;
}

export function TableView({ docs, onEditCell, onDelete }: Props) {
  const columns = useMemo(() => columnsOf(docs), [docs]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { selected, select, clear } = useCellSelection();

  const sorted = useMemo(() => {
    if (!sortKey) return docs;
    const arr = [...docs];
    arr.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] as unknown;
      const bv = (b as Record<string, unknown>)[sortKey] as unknown;
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return String(av) < String(bv) ? -sortDir : sortDir;
    });
    return arr;
  }, [docs, sortKey, sortDir]);

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
    .getAll()
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
      onKeyDown={(e) => keyboardService.dispatch(e.nativeEvent)}
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
                onClick={() => {
                  if (sortKey === c) setSortDir((d) => (d === 1 ? -1 : 1));
                  else {
                    setSortKey(c);
                    setSortDir(1);
                  }
                }}
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
            {onDelete && <th />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const doc = d as Record<string, unknown>;
                const raw = doc[c];
                const isSelected = selected?.rowIndex === i && selected?.colKey === c;
                return (
                  <td
                    key={c}
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
                    {onEditCell ? (
                      <InlineCell
                        value={cellEditString(raw)}
                        onSave={(next) => {
                          const cur = cellEditString(raw);
                          if (next !== cur) onEditCell(i, c, next);
                        }}
                      />
                    ) : (
                      renderCell(raw)
                    )}
                  </td>
                );
              })}
              {onDelete && (
                <td style={{ borderBottom: '1px solid var(--border)', padding: '4px 8px' }}>
                  <button onClick={() => onDelete(i)} title="Delete row">🗑</button>
                </td>
              )}
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
