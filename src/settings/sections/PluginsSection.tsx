import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { register } from '../registry';
import { PluginsSettingsPane } from '../../plugins/ui/PluginsSettingsPane';
import { usePluginRecords } from '../../plugins/usePluginManager';
import type { PluginHost } from '../../plugins/host';

/**
 * Returns the plugin host singleton attached to window by App.tsx at startup,
 * or null when running outside the Tauri renderer (tests, SSR).
 */
function getHost(): PluginHost | null {
  return (window as unknown as Record<string, unknown>).__pluginHost as PluginHost ?? null;
}

/**
 * Inner component rendered only when the host singleton is available.
 * Hooks are always called unconditionally here.
 */
function PluginsSectionInner({ host }: { host: PluginHost }) {
  const records = usePluginRecords(host);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: 'Select plugin folder' });
      if (!selected) return;                // user cancelled
      const dir = typeof selected === 'string' ? selected : selected[0];
      await host.manager.install(dir);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleEnable = async (id: string) => {
    try { await host.manager.activate(id); } catch (e) { setError(String(e)); }
  };

  const handleDisable = async (id: string) => {
    try { await host.manager.deactivate(id); } catch (e) { setError(String(e)); }
  };

  const handleUninstall = async (id: string) => {
    try { await host.manager.uninstall(id); } catch (e) { setError(String(e)); }
  };

  return (
    <>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <PluginsSettingsPane
        records={records}
        onInstall={handleInstall}
        onEnable={handleEnable}
        onDisable={handleDisable}
        onUninstall={handleUninstall}
      />
    </>
  );
}

/**
 * Settings section for the plugin manager.
 * Delegates to PluginsSectionInner once the host singleton is ready;
 * renders an empty pane until then (startup race or test environment).
 */
function PluginsSection() {
  const host = getHost();
  if (!host) {
    return (
      <PluginsSettingsPane
        records={[]}
        onInstall={() => {}}
        onEnable={() => {}}
        onDisable={() => {}}
        onUninstall={() => {}}
      />
    );
  }
  return <PluginsSectionInner host={host} />;
}

// implement this interface to add a new settings section variant
register({ id: 'plugins', label: 'Plugins', icon: '🔌', component: PluginsSection });
