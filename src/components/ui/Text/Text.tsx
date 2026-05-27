import type { HTMLAttributes, ElementType, ReactNode } from 'react';
import styles from './Text.module.css';

type Variant = 'body' | 'mono' | 'dim' | 'error' | 'label';

interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  variant?: Variant;
  selectable?: boolean; // explicit user-select: text
  children: ReactNode;
}

export function Text({
  as: Tag = 'span', variant = 'body', selectable, className, children, ...rest
}: TextProps) {
  const cls = [styles.text, styles[variant], selectable && styles.selectable, className]
    .filter(Boolean).join(' ');
  return <Tag {...rest} className={cls}>{children}</Tag>;
}
