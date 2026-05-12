import { register } from '../registry';
import { PluginsSettingsPane } from '../../plugins/ui/PluginsSettingsPane';

/**
 * Settings section for the plugin manager.
 *
 * Renders the plugins pane with empty records and no-op handlers for now.
 * TODO(phase-d): pull from usePluginRecords once the PluginManager singleton
 * is wired into the app at startup (Task 23).
 */
function PluginsSection() {
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

// implement this interface to add a new settings section variant
register({ id: 'plugins', label: 'Plugins', icon: '🔌', component: PluginsSection });
