import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginDetailPane } from '../plugins/ui/PluginDetailPane';
import type { PluginRecord } from '../plugins/PluginManager';
import type { PluginFs } from '../plugins/io';

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
