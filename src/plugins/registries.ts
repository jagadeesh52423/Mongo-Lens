import { Registry } from './Registry';
import {
  Command, Keybinding, ResultViewer, ViewProvider, ExecutionModeContract,
  AITool, ConnectionProvider, ThemeContract, ExportTargetContract,
} from './api/contracts';

export interface RegistrySet {
  commands:            Registry<Command>;
  keybindings:         Registry<Keybinding>;
  views:               Registry<ViewProvider>;
  resultViewers:       Registry<ResultViewer>;
  executionModes:      Registry<ExecutionModeContract>;
  aiTools:             Registry<AITool>;
  connectionProviders: Registry<ConnectionProvider>;
  themes:              Registry<ThemeContract>;
  exportTargets:       Registry<ExportTargetContract>;
}

export function createRegistrySet(): RegistrySet {
  return {
    commands:            new Registry<Command>('commands'),
    keybindings:         new Registry<Keybinding>('keybindings'),
    views:               new Registry<ViewProvider>('views'),
    resultViewers:       new Registry<ResultViewer>('resultViewers'),
    executionModes:      new Registry<ExecutionModeContract>('executionModes'),
    aiTools:             new Registry<AITool>('aiTools'),
    connectionProviders: new Registry<ConnectionProvider>('connectionProviders'),
    themes:              new Registry<ThemeContract>('themes'),
    exportTargets:       new Registry<ExportTargetContract>('exportTargets'),
  };
}

export function disposeAllForPlugin(set: RegistrySet, pluginId: string): void {
  for (const r of Object.values(set)) r.disposeForPlugin(pluginId);
}
