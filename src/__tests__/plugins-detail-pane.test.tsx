import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginDetailPane, stateBadgeStyle } from '../plugins/ui/PluginDetailPane';
import type { PluginRecord } from '../plugins/PluginManager';
import type { PluginFs } from '../plugins/io';
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import type { ConfigurationContribution } from '../plugins/manifest';

const rec = (over: Partial<PluginRecord> = {}): PluginRecord => ({
  id: 'acme.foo',
  dir: '/plugins/acme.foo',
  state: 'discovered',
  findings: [],
  manifest: { id: 'acme.foo', name: 'Foo', version: '1.2.3',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
  ...over,
});

function fsReturning(file: string | null): PluginFs {
  return {
    listPluginDirs: async () => [],
    readManifest:    async () => '{}',
    readEntry:       async () => '',
    pluginEntryPath: (d, m) => `${d}/${m}`,
    readPluginFile:  async () => file,
  };
}

describe('PluginDetailPane', () => {
  it('renders an empty state when no record selected', () => {
    render(<PluginDetailPane record={null} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/Select a plugin/i)).toBeTruthy();
  });

  it('renders header with name, version, and state', () => {
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/Foo/)).toBeTruthy();
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy();
    expect(screen.getByText(/discovered/)).toBeTruthy();
  });

  it('hides findings section when there are no findings', () => {
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.queryByRole('region', { name: /findings/i })).toBeNull();
  });

  it('shows each finding message and fixHint', () => {
    const r = rec({ findings: [
      { ruleId: 'r', severity: 'warning', message: 'missing X', fixHint: 'add X' },
      { ruleId: 'r', severity: 'error',   message: 'broken Y' },
    ] });
    render(<PluginDetailPane record={r} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/missing X/)).toBeTruthy();
    expect(screen.getByText(/add X/)).toBeTruthy();
    expect(screen.getByText(/broken Y/)).toBeTruthy();
  });

  it('disables Enable button when a blocking finding is present', () => {
    const r = rec({ findings: [{ ruleId: 'r', severity: 'error', message: 'no' }] });
    render(<PluginDetailPane record={r} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    const enable = screen.getByRole('button', { name: /Enable/i }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
  });

  it('lazy-loads README via fs.readPluginFile keyed on record id', async () => {
    const readFile = vi.fn(async () => '# Hello\n\ndocs');
    const fs: PluginFs = {
      listPluginDirs: async () => [],
      readManifest:    async () => '{}',
      readEntry:       async () => '',
      pluginEntryPath: (d, m) => `${d}/${m}`,
      readPluginFile:  readFile,
    };
    render(<PluginDetailPane record={rec()} fs={fs}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('/plugins/acme.foo', 'README.md'));
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy());
  });

  it('shows "No README" placeholder when readPluginFile returns null', async () => {
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No README/i)).toBeTruthy());
  });

  it('fires onEnable when Enable clicked (no blocking finding)', () => {
    const onEnable = vi.fn();
    render(<PluginDetailPane record={rec()} fs={fsReturning(null)}
      onEnable={onEnable} onDisable={() => {}} onUninstall={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Enable/i }));
    expect(onEnable).toHaveBeenCalledWith('acme.foo');
  });
});

describe('stateBadgeStyle — themeable colors', () => {
  const states = ['active', 'discovered', 'failed', 'broken', 'incompatible', 'disabled'];

  it('uses theme tokens, never hardcoded hex or rgba literals', () => {
    for (const state of states) {
      const style = stateBadgeStyle(state);
      const colors = `${String(style.background)} ${String(style.color)}`;
      expect(colors).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(colors).not.toMatch(/\brgba?\(/i);
      expect(colors).toMatch(/var\(--/);
    }
  });

  it('maps active to the green accent token and failed to the red accent token', () => {
    expect(stateBadgeStyle('active').color).toContain('var(--accent-green)');
    expect(stateBadgeStyle('failed').color).toContain('var(--accent-red)');
  });

  it('falls back to the discovered palette for an unknown state', () => {
    expect(stateBadgeStyle('totally-unknown')).toEqual(stateBadgeStyle('discovered'));
  });
});

// ── Task 20 additions ──────────────────────────────────────────────────────────

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

function configRec(schema: ConfigurationContribution) {
  return {
    id: 'p', dir: '/p', state: 'discovered' as const, findings: [],
    manifest: {
      id: 'p', name: 'P', version: '1.0.0',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engines: { mongolens: '^1.0.0' } as any, main: 'm.js',
      contributes: { configuration: schema },
    },
  };
}

function makeConfigService(schema: ConfigurationContribution) {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('p', schema, ws as any, kb);
  const broker = new PermissionBroker();
  return new ConfigService('p', schema, store, broker, { recheckEnforcement: async () => {} });
}

describe('PluginDetailPane — inline Settings section', () => {
  const schema: ConfigurationContribution = {
    title: 'P',
    properties: { url: { type: 'string', title: 'URL' } },
  };

  it('renders Settings section when manifest declares contributes.configuration', async () => {
    const cfgService = makeConfigService(schema);
    render(<PluginDetailPane
      record={configRec(schema)} fs={fsReturning(null)}
      configService={cfgService}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}}
    />);
    await screen.findByText(/Settings/i);
    expect(screen.getByLabelText('URL')).toBeTruthy();
  });

  it('does NOT render Settings section when manifest has no configuration', () => {
    const r = {
      id: 'p', dir: '/p', state: 'discovered' as const, findings: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manifest: { id: 'p', name: 'P', version: '1.0.0', engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
    };
    render(<PluginDetailPane record={r} fs={fsReturning(null)}
      configService={undefined}
      onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}}
    />);
    expect(screen.queryByText(/^Settings$/i)).toBeNull();
  });
});
