import type { PluginManifest } from '../manifest';
import type { PluginFs } from '../io';
import type { KeychainBackend, WorkspaceLike } from '../config';

export interface RuleContext {
  pluginDir: string;
  manifest: PluginManifest;
  fs: PluginFs;
  workspace?: WorkspaceLike;
  keychain?: KeychainBackend;
}

export interface Finding {
  ruleId: string;
  severity: 'error' | 'warning';
  message: string;
  fixHint?: string;
}

export interface Rule {
  id: string;
  title: string;
  defaultSeverity: 'error' | 'warning';
  check(ctx: RuleContext): Promise<Finding[]>;
}
