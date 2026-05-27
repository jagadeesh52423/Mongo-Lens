import { useEffect, useRef, useState } from 'react';
import type { ActivityItem } from '../../../layout/activityBar';

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
      el.style.position = 'absolute';
      el.style.inset = '0';
      // Scrollable views get a vertical scroll container managed by the host
      // so each view doesn't have to reimplement flex+overflow scaffolding.
      // Non-scrollable views own their full layout (must fill 100% height).
      el.style.overflowY = item.scrollable ? 'auto' : 'hidden';
      el.style.overflowX = 'hidden';
      host.appendChild(el);
      try {
        const disposable = item.render(el);
        entry = { el, disposable };
        cacheRef.current.set(item.id, entry);
      } catch (e) {
        host.removeChild(el);
        setError(e instanceof Error ? e.message : String(e));
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
    <div
      style={{
        width: '100%', height: '100%',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        data-testid="side-panel-title"
        style={{
          padding: '8px 12px', fontSize: 11,
          textTransform: 'uppercase', color: 'var(--fg-dim)',
          letterSpacing: 1, borderBottom: '1px solid var(--border)',
        }}
      >
        {item?.title ?? ''}
      </div>
      {error && (
        <div role="alert" style={{ padding: 12, color: 'var(--error, red)' }}>
          View failed to render: {error}
        </div>
      )}
      <div
        ref={hostRef}
        style={{
          flex: 1, minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          display: item && !error ? 'block' : 'none',
        }}
      />
      {!item && !error && (
        <div data-testid="side-panel-empty" style={{ flex: 1, padding: 12, color: 'var(--fg-dim)' }}>
          No view selected.
        </div>
      )}
    </div>
  );
}
