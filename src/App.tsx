import { useState } from 'react';
import { useScriptEvents } from './hooks/useScriptEvents';
import { useRunnerBootstrap } from './hooks/useRunnerBootstrap';
import { usePluginHostBootstrap } from './hooks/usePluginHostBootstrap';
import { useActivitySystem } from './hooks/useActivitySystem';
import { useAIChatOrchestrator } from './components/features/ai/useAIChatOrchestrator';
import { AppContextProviders } from './components/features/layout/AppContextProviders';
import { AppKeyboardWiring } from './components/features/layout/AppKeyboardWiring';
import { AppShell } from './components/features/layout/AppShell';

/**
 * Root component. Composes the three orthogonal layers:
 *  - `AppContextProviders` — wraps the tree in any app-wide React contexts
 *  - `AppKeyboardWiring`   — owns global keyboard wiring (renderless)
 *  - `AppShell`            — owns the visible layout
 *
 * The custom hooks fan out bootstrap concerns so this component stays a thin
 * orchestrator: runner installation, plugin host discovery, activity-bar
 * items, and AI chat lifecycle each live in their own hook.
 */
export default function App() {
  useScriptEvents();
  useRunnerBootstrap();
  usePluginHostBootstrap();
  const activity = useActivitySystem();
  const aiChat = useAIChatOrchestrator();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <AppContextProviders>
      <AppKeyboardWiring onToggleSettings={() => setSettingsOpen((s) => !s)} />
      <AppShell
        items={activity.items}
        activeId={activity.activeId}
        onChangeActiveItem={activity.onChangeActive}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((s) => !s)}
        onCloseSettings={() => setSettingsOpen(false)}
        onSendMessage={aiChat.sendMessage}
        onClearContext={aiChat.clearContext}
      />
    </AppContextProviders>
  );
}
