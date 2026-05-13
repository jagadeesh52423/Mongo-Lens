import type { PluginManifest } from '../manifest';
import type { PluginFs } from '../io';

export interface RuleContext {
  pluginDir: string;
  manifest: PluginManifest;
  fs: PluginFs;
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
