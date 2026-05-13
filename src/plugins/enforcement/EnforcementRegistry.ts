import type { Rule } from './types';

export class EnforcementRegistry {
  private rules: Rule[] = [];
  private ids = new Set<string>();

  register(rule: Rule): void {
    if (this.ids.has(rule.id)) {
      throw new Error(`EnforcementRegistry: rule "${rule.id}" already registered`);
    }
    this.ids.add(rule.id);
    this.rules.push(rule);
  }

  all(): readonly Rule[] {
    return this.rules;
  }
}
