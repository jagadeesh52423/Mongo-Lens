import type { Rule } from '../types';

const RULE_ID = 'core.readme-present';

export const readmePresentRule: Rule = {
  id: RULE_ID,
  title: 'README required',
  defaultSeverity: 'warning',
  async check({ pluginDir, fs }) {
    const content = fs.readPluginFile
      ? await fs.readPluginFile(pluginDir, 'README.md')
      : null;

    if (content === null) {
      return [{
        ruleId: RULE_ID,
        severity: 'warning',
        message: 'README.md is missing',
        fixHint: 'Add a README.md at the plugin root describing what this plugin does.',
      }];
    }
    if (content.trim().length === 0) {
      return [{
        ruleId: RULE_ID,
        severity: 'warning',
        message: 'README.md is empty',
        fixHint: 'Describe what your plugin does, how to enable it, and any required permissions.',
      }];
    }
    return [];
  },
};
