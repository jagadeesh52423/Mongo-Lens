/**
 * Dialog compound primitive — extension point for modal sections.
 *
 * To add a new section (e.g. Dialog.Sidebar):
 *   1. Implement the section as a function component using styles from Dialog.module.css.
 *   2. Attach it to the export via `Object.assign(DialogRoot, { ..., Sidebar: DialogSidebar })`.
 * No edits needed elsewhere.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { IconButton } from '../IconButton';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  width?: number | string;
  children: ReactNode;
}

function DialogRoot({ open, onClose, ariaLabel, width = 520, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-label={ariaLabel}
        aria-modal="true"
        className={styles.dialog}
        style={{ width }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

function DialogHeader({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div className={styles.header}>
      <div className={styles.title}>{title}</div>
      {onClose && <IconButton aria-label="Close dialog" icon="✕" onClick={onClose} />}
    </div>
  );
}
function DialogBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}
function DialogFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

export const Dialog = Object.assign(DialogRoot, {
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
});
