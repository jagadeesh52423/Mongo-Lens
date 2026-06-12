import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import styles from './PasswordField.module.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordField({ disabled, className, ...rest }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={styles.wrapper}>
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={[styles.input, className].filter(Boolean).join(' ')}
      />
      <button
        type="button"
        className={styles.toggle}
        aria-label={visible ? 'Hide password' : 'Show password'}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? '🙈' : '👁'}
      </button>
    </div>
  );
}
