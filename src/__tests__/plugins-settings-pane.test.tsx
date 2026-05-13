import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginsSettingsPane } from '../plugins/ui/PluginsSettingsPane';
import type { PluginRecord } from '../plugins/PluginManager';
import type { PluginFs } from '../plugins/io';

const fs: PluginFs = {
  listPluginDirs: async () => [],
  readManifest:    async () => '{}',
  readEntry:       async () => '',
  pluginEntryPath: (d, m) => `${d}/${m}`,
  readPluginFile:  async () => null,
};

const rec = (id: string, name: string): PluginRecord => ({
  id, dir: `/p/${id}`, state: 'discovered', findings: [],
  manifest: { id, name, version: '1.0.0',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
});

describe('PluginsSettingsPane', () => {
  it('renders the install button', () => {
    render(<PluginsSettingsPane records={[]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByRole('button', { name: /Install/i })).toBeTruthy();
  });

  it('auto-selects the first record on mount', async () => {
    render(<PluginsSettingsPane records={[rec('a', 'Alpha'), rec('b', 'Beta')]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await waitFor(() => {
      const detail = screen.getByLabelText(/Plugin detail/i);
      expect(detail.textContent).toMatch(/Alpha/);
    });
  });

  it('switches detail pane when a different list item is clicked', async () => {
    render(<PluginsSettingsPane records={[rec('a', 'Alpha'), rec('b', 'Beta')]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    const items = screen.getAllByRole('listitem');
    fireEvent.click(items[1]);
    await waitFor(() => {
      const detail = screen.getByLabelText(/Plugin detail/i);
      expect(detail.textContent).toMatch(/Beta/);
    });
  });

  it('shows empty state when there are no plugins', () => {
    render(<PluginsSettingsPane records={[]} fs={fs}
      onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText(/No plugins installed/i)).toBeTruthy();
  });

  it('passes through onInstall callback', () => {
    const onInstall = vi.fn();
    render(<PluginsSettingsPane records={[]} fs={fs}
      onInstall={onInstall} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Install/i }));
    expect(onInstall).toHaveBeenCalled();
  });
});
