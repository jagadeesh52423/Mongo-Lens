/**
 * FormField compound primitive — extension point for form-field building blocks.
 *
 * To add a new sub-component (e.g. FormField.Select):
 *   1. Implement the sub-component as a function component using styles from FormField.module.css.
 *   2. Attach it to the export via `Object.assign(Root, { ..., Select: FormFieldSelect })`.
 * No edits needed elsewhere.
 */
import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';
import styles from './FormField.module.css';

function Root({ children }: { children: ReactNode }) {
  return <div className={styles.field}>{children}</div>;
}
function Label({ children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...rest} className={styles.label}>{children}</label>;
}
function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={[styles.input, props.className].filter(Boolean).join(' ')} />;
}
function ErrorText({ children }: { children: ReactNode }) {
  return children ? <div className={styles.error}>{children}</div> : null;
}

export const FormField = Object.assign(Root, { Label, Input, Error: ErrorText });
