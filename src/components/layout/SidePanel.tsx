import { useEffect, useRef, useState } from 'react';
import type { ActivityItem } from '../../layout/activityBar';

interface Props { item: ActivityItem | null }

export function SidePanel({ item }: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!item || !bodyRef.current) return;
    let disposable: { dispose(): void } | null = null;
    try {
      disposable = item.render(bodyRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      try { disposable?.dispose(); } catch { /* never throw */ }
    };
  }, [item?.id]);

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
      {error ? (
        <div role="alert" style={{ padding: 12, color: 'var(--error, red)' }}>
          View failed to render: {error}
        </div>
      ) : item ? (
        <div ref={bodyRef} style={{ flex: 1, overflow: 'auto' }} />
      ) : (
        <div data-testid="side-panel-empty" style={{ flex: 1, padding: 12, color: 'var(--fg-dim)' }}>
          No view selected.
        </div>
      )}
    </div>
  );
}
