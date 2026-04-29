import { useEffect, useRef, type ReactNode } from 'react';

interface RecordModalShellProps {
  title: string;
  body: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  // Optional gate run before any close path. If it returns false, close is cancelled.
  beforeClose?: () => boolean | Promise<boolean>;
}

export function RecordModalShell({ title, body, footer, onClose, beforeClose }: RecordModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const beforeCloseRef = useRef(beforeClose);
  beforeCloseRef.current = beforeClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  async function tryClose() {
    if (beforeCloseRef.current) {
      const result = await beforeCloseRef.current();
      if (result === false) return;
    }
    onClose();
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) tryClose();
  }

  function handleBackdropKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { tryClose(); return; }
    e.stopPropagation();
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onKeyDown={handleBackdropKeyDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          width: 600,
          maxWidth: '90vw',
          height: '80vh',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 12,
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{title}</span>
          <button aria-label="Close" onClick={tryClose}>✕</button>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {body}
        </div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
