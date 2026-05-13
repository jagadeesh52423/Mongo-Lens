import { describe, it, expect } from 'vitest';
import { readmePresentRule } from '../plugins/enforcement/rules/readmePresent';
import type { RuleContext } from '../plugins/enforcement/types';
import type { PluginFs } from '../plugins/io';

function ctx(file: string | null): RuleContext {
  const fs: PluginFs = {
    listPluginDirs: async () => [],
    readManifest:    async () => '{}',
    readEntry:       async () => '',
    pluginEntryPath: (d, m) => `${d}/${m}`,
    readPluginFile:  async () => file,
  };
  return {
    pluginDir: '/plugins/x',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifest: { id: 'x', name: 'X', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'main.js' } as any,
    fs,
  };
}

describe('readmePresentRule', () => {
  it('returns a warning when README is missing', async () => {
    const findings = await readmePresentRule.check(ctx(null));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'core.readme-present',
      severity: 'warning',
    });
    expect(findings[0].message).toMatch(/missing/i);
    expect(findings[0].fixHint).toBeTruthy();
  });

  it('returns a warning when README is empty or whitespace', async () => {
    const findings = await readmePresentRule.check(ctx('   \n  \t  '));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/empty/i);
  });

  it('returns no findings for a non-empty README', async () => {
    const findings = await readmePresentRule.check(ctx('# Hello\n\nsome content'));
    expect(findings).toEqual([]);
  });

  it('treats a missing readPluginFile method as missing file', async () => {
    const fs: PluginFs = {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
      // no readPluginFile
    };
    const findings = await readmePresentRule.check({
      pluginDir: '/p/x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manifest: { id: 'x', name: 'X', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'main.js' } as any,
      fs,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/missing/i);
  });
});
