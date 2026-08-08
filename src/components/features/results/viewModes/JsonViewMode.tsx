import { useEffect, useRef } from 'react';
import { JsonView } from '../JsonView';
import styles from './viewMode.module.css';
import { keyboardService } from '../../../../services/KeyboardService';
import type { ResultViewMode } from './ViewModeRegistry';

function JsonViewModeComponent({
  group,
  onRenderedDocsChange,
}: Parameters<ResultViewMode['Component']>[0]) {
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

  // JSON view doesn't reorder docs and doesn't surface columns. Publish the
  // group's docs as-is so docsRef stays consistent across Table↔JSON switches.
  useEffect(() => {
    onRenderedDocsChange?.(group.docs, []);
  }, [group, onRenderedDocsChange]);

  return (
    <div ref={containerRef} className={styles.fill}>
      <JsonView docs={group.docs} />
    </div>
  );
}

export const JsonViewMode: ResultViewMode = {
  id: 'json',
  label: 'JSON',
  Component: JsonViewModeComponent,
};
