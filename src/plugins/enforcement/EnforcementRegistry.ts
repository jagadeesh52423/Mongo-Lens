import type { Rule, RuleContext, Finding } from './types';

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

  async runAll(ctx: RuleContext): Promise<Finding[]> {
    const out: Finding[] = [];
    for (const rule of this.rules) {
      try {
        const findings = await rule.check(ctx);
        out.push(...findings);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        out.push({
          ruleId: rule.id,
          severity: 'error',
          message: `rule "${rule.id}" threw: ${msg}`,
        });
      }
    }
    return out;
  }
}
