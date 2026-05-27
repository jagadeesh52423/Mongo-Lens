import { useEffect, useRef } from 'react';
import { JsonView } from '../JsonView';
import { keyboardService } from '../../../../services/KeyboardService';
import { DEFAULT_SHORTCUTS } from '../../../../shortcuts/defaults';
import type { ResultViewMode } from './ViewModeRegistry';

// Define the select-all shortcut once at module load so the registration below
// always has a known definition to bind to.
const selectAllDef = DEFAULT_SHORTCUTS.find((d) => d.id === 'results.selectAll');
if (selectAllDef) keyboardService.defineShortcut(selectAllDef);

function JsonViewModeComponent({ group }: Parameters<ResultViewMode['Component']>[0]) {
  const containerRef = useRef<HTMLDivElement>(null);

  // While JSON view is mounted, Cmd+A selects the body text. The handler is
  // bound to the live container ref so it always operates on the current view.
  useEffect(() => {
    return keyboardService.register('results.selectAll', () => {
      const el = containerRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }, []);

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <JsonView docs={group.docs} />
    </div>
  );
}

export const JsonViewMode: ResultViewMode = {
  id: 'json',
  label: 'JSON',
  Component: JsonViewModeComponent,
};
