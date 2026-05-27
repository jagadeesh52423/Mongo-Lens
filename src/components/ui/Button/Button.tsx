/**
 * Button primitive — extension point for visual variants.
 *
 * To add a new variant:
 *   1. Extend ButtonVariant union below.
 *   2. Add a `.<name>` rule in Button.module.css under the variant block.
 * No edits needed elsewhere.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const cls = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} className={cls} disabled={disabled || loading}>
      {loading ? <span className={styles.spinner} aria-hidden /> : iconLeft}
      <span className={styles.label}>{children}</span>
      {iconRight}
    </button>
  );
}
