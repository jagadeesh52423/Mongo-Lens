import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginsSettingsPane } from '../plugins/ui/PluginsSettingsPane';
import type { PluginRecord } from '../plugins/PluginManager';
import type { PluginFs } from '../plugins/io';
import type { ConfigService } from '../plugins/config/ConfigService';
import type { ConfigurationContribution } from '../plugins/manifest';

const fs: PluginFs = {
  listPluginDirs: async () => [],
  readManifest:    async () => '{}',
  readEntry:       async () => '',
  pluginEntryPath: (d, m) => `${d}/${m}`,
  readPluginFile:  async () => null,
};

const schema: ConfigurationContribution = {
  title: 'Datafleet',
  properties: { url: { type: 'string', title: 'API URL' } },
};

/** Minimal ConfigService stub for UI testing. */
function makeConfigService(): ConfigService {
  return {
    get: async () => undefined,
    getAll: async () => ({ url: '' }),
    set: async () => {},
    save: async () => {},
    onDidChange: () => ({ dispose() {} }),
  } as unknown as ConfigService;
}

const recWithConfig = (id: string, name: string): PluginRecord => ({
  id,
  dir: `/p/${id}`,
  state: 'discovered',
  findings: [],
  manifest: {
    id,
    name,
    version: '1.0.0',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engines: { mongolens: '^1.0.0' } as any,
    main: 'm.js',
    contributes: { configuration: schema },
  },
});

describe('PluginsSettingsPane — Configure… button navigation', () => {
  it('opens PluginConfigRoute when Configure… is clicked and returns to detail pane on Back', async () => {
    const configSvc = makeConfigService();
    const records = [recWithConfig('plugin.a', 'Datafleet')];

    render(
      <PluginsSettingsPane
        records={records}
        fs={fs}
        onInstall={() => {}}
        onEnable={() => {}}
        onDisable={() => {}}
        onUninstall={() => {}}
        getConfigService={() => configSvc}
      />
    );

    // Detail pane header must be visible initially
    await waitFor(() => {
      expect(screen.getByLabelText(/Plugin detail/i)).toBeTruthy();
    });

    // Click the Configure… button (rendered in SettingsSection header)
    const configureBtn = await screen.findByRole('button', { name: /Configure…/i });
    fireEvent.click(configureBtn);

    // PluginConfigRoute breadcrumb must now be visible
    await waitFor(() => {
      expect(screen.getByText(/Plugins.*Datafleet.*Settings/)).toBeTruthy();
    });

    // Click the Back button in PluginConfigRoute
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    // Detail pane must be visible again
    await waitFor(() => {
      expect(screen.getByLabelText(/Plugin detail/i)).toBeTruthy();
    });
  });

  it('Configure… button is absent when plugin has no contributes.configuration', () => {
    const records: PluginRecord[] = [{
      id: 'plain.plugin',
      dir: '/p/plain.plugin',
      state: 'discovered',
      findings: [],
      manifest: {
        id: 'plain.plugin',
        name: 'Plain',
        version: '1.0.0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        engines: { mongolens: '^1.0.0' } as any,
        main: 'm.js',
      },
    }];

    render(
      <PluginsSettingsPane
        records={records}
        fs={fs}
        onInstall={() => {}}
        onEnable={() => {}}
        onDisable={() => {}}
        onUninstall={() => {}}
        getConfigService={() => undefined}
      />
    );

    expect(screen.queryByRole('button', { name: /Configure…/i })).toBeNull();
  });
});
