import type { HTMLAttributes, ReactNode } from 'react';
import styles from './ListRow.module.css';

interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  indent?: number;
  children: ReactNode;
}

export function ListRow({
  selected, icon, trailing, indent = 0, className, children, ...rest
}: ListRowProps) {
  const cls = [styles.row, selected && styles.selected, className].filter(Boolean).join(' ');
  return (
    <div
      {...rest}
      className={cls}
      style={{ paddingLeft: `calc(${indent} * var(--space-3) + var(--space-2))` }}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.label}>{children}</span>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
}
