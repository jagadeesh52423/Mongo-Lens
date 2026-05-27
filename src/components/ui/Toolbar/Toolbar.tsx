import type { ReactNode, HTMLAttributes } from 'react';
import styles from './Toolbar.module.css';

interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}

export function Toolbar({ left, right, children, className, ...rest }: ToolbarProps) {
  return (
    <div {...rest} className={[styles.toolbar, className].filter(Boolean).join(' ')}>
      <div className={styles.section}>{left ?? children}</div>
      {right && <div className={styles.section}>{right}</div>}
    </div>
  );
}
