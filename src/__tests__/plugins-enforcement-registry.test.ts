import { describe, it, expect } from 'vitest';
import { EnforcementRegistry } from '../plugins/enforcement/EnforcementRegistry';
import type { Rule } from '../plugins/enforcement/types';

const noopRule = (id: string): Rule => ({
  id, title: id, defaultSeverity: 'warning',
  check: async () => [],
});

describe('EnforcementRegistry register/all', () => {
  it('registers and lists a rule', () => {
    const reg = new EnforcementRegistry();
    reg.register(noopRule('a'));
    expect(reg.all().map(r => r.id)).toEqual(['a']);
  });

  it('throws on duplicate id', () => {
    const reg = new EnforcementRegistry();
    reg.register(noopRule('a'));
    expect(() => reg.register(noopRule('a'))).toThrow(/already registered/);
  });

  it('preserves registration order', () => {
    const reg = new EnforcementRegistry();
    reg.register(noopRule('a'));
    reg.register(noopRule('b'));
    reg.register(noopRule('c'));
    expect(reg.all().map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});
