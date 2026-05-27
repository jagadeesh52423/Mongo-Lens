import { useEffect, useRef, type ReactNode } from 'react';
import styles from './RecordModalShell.module.css';

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
      className={styles.backdrop}
      onKeyDown={handleBackdropKeyDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={styles.dialog}
      >
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button aria-label="Close" onClick={tryClose}>✕</button>
        </div>
        <div className={styles.body}>{body}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
