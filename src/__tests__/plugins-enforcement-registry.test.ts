import { describe, it, expect } from 'vitest';
import { EnforcementRegistry } from '../plugins/enforcement/EnforcementRegistry';
import type { Rule, RuleContext, Finding } from '../plugins/enforcement/types';

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

function dummyCtx(): RuleContext {
  return {
    pluginDir: '/p/x',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifest: { id: 'x', name: 'X', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'main.js' } as any,
    fs: {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
  };
}

describe('EnforcementRegistry runAll', () => {
  it('aggregates findings from all rules in registration order', async () => {
    const reg = new EnforcementRegistry();
    reg.register({ id: 'a', title: 'a', defaultSeverity: 'warning',
      check: async () => [{ ruleId: 'a', severity: 'warning', message: 'A1' }] });
    reg.register({ id: 'b', title: 'b', defaultSeverity: 'warning',
      check: async () => [
        { ruleId: 'b', severity: 'warning', message: 'B1' },
        { ruleId: 'b', severity: 'error',   message: 'B2' },
      ] });
    const findings: Finding[] = await reg.runAll(dummyCtx());
    expect(findings.map(f => f.message)).toEqual(['A1', 'B1', 'B2']);
  });

  it('converts a throwing rule into one synthetic error finding without aborting', async () => {
    const reg = new EnforcementRegistry();
    reg.register({ id: 'boom', title: 'boom', defaultSeverity: 'warning',
      check: async () => { throw new Error('nope'); } });
    reg.register({ id: 'ok', title: 'ok', defaultSeverity: 'warning',
      check: async () => [{ ruleId: 'ok', severity: 'warning', message: 'still ran' }] });
    const findings = await reg.runAll(dummyCtx());
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ ruleId: 'boom', severity: 'error' });
    expect(findings[0].message).toMatch(/boom.*nope/);
    expect(findings[1].message).toBe('still ran');
  });
});
