import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string; // required
  icon: ReactNode;
  pressed?: boolean;
  tooltip?: string;
  size?: 'sm' | 'md';
}

export function IconButton({ icon, pressed, size = 'md', tooltip, className, ...rest }: IconButtonProps) {
  const cls = [styles.btn, styles[size], pressed && styles.pressed, className].filter(Boolean).join(' ');
  return (
    <button {...rest} className={cls} title={tooltip} aria-pressed={pressed}>
      {icon}
    </button>
  );
}
