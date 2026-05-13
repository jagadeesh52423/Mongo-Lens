import { describe, it, expect, vi } from 'vitest';
import { PluginManager, hasBlockingFindings } from '../plugins/PluginManager';
import { createRegistrySet } from '../plugins/registries';
import { PermissionBroker } from '../plugins/PermissionBroker';
import { EnforcementRegistry } from '../plugins/enforcement/EnforcementRegistry';
import type { Rule } from '../plugins/enforcement/types';

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const MANIFEST = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
};

function makeRule(id: string, findings: Array<{ severity: 'error' | 'warning'; message: string }>): Rule {
  return {
    id, title: id, defaultSeverity: 'warning',
    check: async () => findings.map(f => ({ ruleId: id, ...f })),
  };
}

describe('PluginManager enforcement integration', () => {
  it('populates record.findings after discover when a rule emits warnings', async () => {
    const enforcement = new EnforcementRegistry();
    enforcement.register(makeRule('warn.rule', [{ severity: 'warning', message: 'missing X' }]));
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
      enforcement,
    });
    await mgr.discover();
    const rec = mgr.get('acme.foo')!;
    expect(rec.findings).toHaveLength(1);
    expect(rec.findings[0]).toMatchObject({ ruleId: 'warn.rule', severity: 'warning', message: 'missing X' });
    expect(hasBlockingFindings(rec)).toBe(false);
  });

  it('defaults findings to empty array even with no enforcement option', async () => {
    const mgr = new PluginManager({
      registries: createRegistrySet(),
      broker: new PermissionBroker(),
      hostApiVersion: '1.0.0',
      logger: silentLogger(),
      fs: {
        listPluginDirs: async () => ['/plugins/acme.foo'],
        readManifest:    async () => JSON.stringify(MANIFEST),
        readEntry:       async () => 'export function activate(){}',
        pluginEntryPath: (d, m) => `${d}/${m}`,
      },
    });
    await mgr.discover();
    expect(mgr.get('acme.foo')!.findings).toEqual([]);
  });

  it('hasBlockingFindings returns true only for error-severity findings', () => {
    expect(hasBlockingFindings({ id: 'x', dir: '/x', state: 'discovered', findings: [] })).toBe(false);
    expect(hasBlockingFindings({ id: 'x', dir: '/x', state: 'discovered',
      findings: [{ ruleId: 'r', severity: 'warning', message: 'm' }] })).toBe(false);
    expect(hasBlockingFindings({ id: 'x', dir: '/x', state: 'discovered',
      findings: [{ ruleId: 'r', severity: 'error', message: 'm' }] })).toBe(true);
  });
});
