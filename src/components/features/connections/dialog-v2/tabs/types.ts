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
}

export interface TabSpec {
  id: TabId;
  label: string;
  group: TabGroup;
  Form: ComponentType<TabFormProps>;
  validate: (value: Connection) => ValidationIssue[];
  hasOverrides?: (value: Connection) => boolean;
}
