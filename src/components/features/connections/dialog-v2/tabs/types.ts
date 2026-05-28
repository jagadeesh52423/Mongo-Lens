import type { ComponentType } from 'react';
import type { Connection } from '../../../../../connection/model';
import type { GlobalPrefs } from '../../../../../connection/overrides';
import type { ValidationIssue } from '../../../../../connection/validation';
import type { SecretSlot } from '../../../../../connection/ipc';

export type TabId =
  | 'server' | 'auth' | 'tls' | 'ssh' | 'proxy'
  | 'intelliShell' | 'tools' | 'advanced';

export type TabGroup = 'transport' | 'prefs';

export interface TabFormProps {
  value: Connection;
  onChange: (next: Connection) => void;
  globals: GlobalPrefs;
  secrets: Partial<Record<SecretSlot, string>>;
  onSecretChange: (slot: SecretSlot, value: string) => void;
  /** Optional callback the shell wires to the reducer's `set-auth-kind`. */
  onAuthKindChange?: (kind: import('../../../../../connection/model').AuthMode['kind']) => void;
}

/**
 * Props for variant sub-forms inside a tab (auth/* and ssh/*). Shape is
 * identical to TabFormProps — kept as a distinct alias so sub-forms can
 * declare their narrower intent at the type level.
 *
 * To add a new sub-form: import this type, narrow on the variant kind in
 * the body, and return JSX bound to the active variant's fields.
 */
export type SubFormProps = TabFormProps;

export interface TabSpec {
  id: TabId;
  label: string;
  group: TabGroup;
  Form: ComponentType<TabFormProps>;
  validate: (value: Connection) => ValidationIssue[];
  hasOverrides?: (value: Connection) => boolean;
}
