import type { Rule } from '../types';
import { ConfigStore } from '../../config/ConfigStore';

const RULE_ID = 'core.required-config';

export const requiredConfigRule: Rule = {
  id: RULE_ID,
  title: 'Required configuration must be set',
  defaultSeverity: 'warning',
  async check({ manifest, workspace, keychain }) {
    const cfg = manifest.contributes?.configuration;
    const required = cfg?.required ?? [];
    if (required.length === 0 || !workspace || !keychain) return [];

    const store = new ConfigStore(manifest.id, cfg!, workspace, keychain);
    const stored = await store.getAll();
    const missing = required.filter(k => stored[k] === undefined || stored[k] === '');
    if (missing.length === 0) return [];

    const blocking = manifest.activation?.requireConfig === true;
    return [{
      ruleId: RULE_ID,
      severity: blocking ? 'error' : 'warning',
      message: `Required configuration missing: ${missing.join(', ')}`,
      fixHint: "Open the Settings section on this plugin's detail pane and fill in the highlighted fields.",
    }];
  },
};
