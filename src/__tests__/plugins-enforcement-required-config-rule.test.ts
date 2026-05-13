import { describe, it, expect } from 'vitest';
import { requiredConfigRule } from '../plugins/enforcement/rules/requiredConfig';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import type { RuleContext } from '../plugins/enforcement/types';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

function ctx(manifestOver: Record<string, unknown> = {}, wsValues: Record<string, unknown> = {}, kbValues: Record<string, string> = {}): RuleContext {
  const ws = new FakeWorkspace();
  for (const [k, v] of Object.entries(wsValues)) ws.store.set(k, v);
  const kb = new InMemoryKeychainBackend();
  for (const [k, v] of Object.entries(kbValues)) kb.set(k, v);
  return {
    pluginDir: '/p',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifest: {
      id: 'p', name: 'P', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'm.js',
      contributes: {
        configuration: {
          title: 'P',
          properties: {
            url:      { type: 'string' },
            password: { type: 'string', 'x-secret': true },
          },
          required: ['url', 'password'],
        },
      },
      ...manifestOver,
    } as any,
    fs: {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workspace: ws as any,
    keychain: kb,
  };
}

describe('requiredConfigRule', () => {
  it('returns no findings when manifest has no configuration block', async () => {
    const c = ctx({ contributes: {} });
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });

  it('returns no findings when no required keys', async () => {
    const c = ctx({ contributes: { configuration: { title: 'X', properties: { url: { type: 'string' } } } } });
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });

  it('warning when required missing and requireConfig is absent', async () => {
    const c = ctx();
    const findings = await requiredConfigRule.check(c);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/url.*password|password.*url/);
  });

  it('error when required missing and requireConfig is true', async () => {
    const c = ctx({ activation: { requireConfig: true } });
    const findings = await requiredConfigRule.check(c);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('no findings when all required values are set', async () => {
    const c = ctx(
      { activation: { requireConfig: true } },
      { 'plugin.p.config.url': 'http://x' },
      { 'plugin:p:config:password': 'pw' },
    );
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });

  it('no findings when workspace + keychain are absent (no-op)', async () => {
    const c = ctx();
    c.workspace = undefined;
    c.keychain = undefined;
    expect(await requiredConfigRule.check(c)).toEqual([]);
  });
});
