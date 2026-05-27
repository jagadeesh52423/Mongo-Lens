import { useEffect, useRef, useState } from 'react';
import { Panel } from '../../ui';
import type { ActivityItem } from '../../../layout/activityBar';
import styles from './SidePanel.module.css';

interface Props { item: ActivityItem | null }

interface CachedView {
  el: HTMLDivElement;
  disposable: { dispose(): void } | null;
}

export function SidePanel({ item }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef<Map<string, CachedView>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const host = hostRef.current;
    if (!host) return;

    cacheRef.current.forEach(({ el }, id) => {
      el.style.display = item && id === item.id ? '' : 'none';
    });

    if (!item) return;

    let entry = cacheRef.current.get(item.id);
    if (!entry) {
      const el = document.createElement('div');
      // Scrollable views get a vertical scroll container managed by the host
      // so each view doesn't have to reimplement flex+overflow scaffolding.
      // Non-scrollable views own their full layout (must fill 100% height).
      el.className = `${styles.viewSlot} ${item.scrollable ? styles.viewSlotScrollable : styles.viewSlotFixed}`;
      host.appendChild(el);
      try {
        const disposable = item.render(el);
        entry = { el, disposable };
        cacheRef.current.set(item.id, entry);
      } catch (renderError) {
        host.removeChild(el);
        setError(renderError instanceof Error ? renderError.message : String(renderError));
      }
    }
  }, [item?.id]);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      cache.forEach(({ disposable }) => {
        try { disposable?.dispose(); } catch { /* never throw */ }
      });
      cache.clear();
    };
  }, []);

  return (
    <Panel className={styles.shell}>
      <Panel.Header title={<span data-testid="side-panel-title">{item?.title ?? ''}</span>} />
      {error && (
        <div role="alert" className={styles.errorMsg}>
          View failed to render: {error}
        </div>
      )}
      <div
        ref={hostRef}
        className={styles.host}
        style={{ display: item && !error ? 'block' : 'none' }}
      />
      {!item && !error && (
        <div data-testid="side-panel-empty" className={styles.empty}>
          No view selected.
        </div>
      )}
    </Panel>
  );
}
