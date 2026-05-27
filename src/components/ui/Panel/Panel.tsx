/**
 * Panel compound primitive — extension point for panel sections.
 *
 * To add a new section (e.g. Panel.Sidebar):
 *   1. Implement the section as a function component using styles from Panel.module.css.
 *   2. Attach it to the export via `Object.assign(PanelRoot, { ..., Sidebar: PanelSidebar })`.
 * No edits needed elsewhere.
 */
import type { ReactNode, HTMLAttributes } from 'react';
import styles from './Panel.module.css';

interface PanelProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; }
function PanelRoot({ className, children, ...rest }: PanelProps) {
  return <div {...rest} className={[styles.panel, className].filter(Boolean).join(' ')}>{children}</div>;
}

interface HeaderProps { title?: ReactNode; right?: ReactNode; children?: ReactNode; }
function PanelHeader({ title, right, children }: HeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.title}>{title ?? children}</div>
      {right && <div className={styles.right}>{right}</div>}
    </div>
  );
}

function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.body, className].filter(Boolean).join(' ')}>{children}</div>;
}
function PanelFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

export const Panel = Object.assign(PanelRoot, { Header: PanelHeader, Body: PanelBody, Footer: PanelFooter });
