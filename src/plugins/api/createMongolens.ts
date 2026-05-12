import { Disposable } from './disposable';
import { RegistrySet } from '../registries';
import { HostServices } from '../hostServices';
import {
  Command, ResultViewer, ViewProvider, ExecutionModeContract,
  AITool, ConnectionProvider, ThemeContract, ExportTargetContract,
} from './contracts';

export interface MongolensAPI {
  commands: {
    register(id: string, handler: Command['handler']): Disposable;
    execute(id: string, ...args: unknown[]): Promise<unknown>;
  };
  views:               { register(v: ViewProvider): Disposable };
  resultViewers:       { register(v: ResultViewer): Disposable };
  executionModes:      { register(v: ExecutionModeContract): Disposable };
  aiTools:             { register(v: AITool): Disposable };
  connectionProviders: { register(v: ConnectionProvider): Disposable };
  themes:              { register(v: ThemeContract): Disposable };
  exportTargets:       { register(v: ExportTargetContract): Disposable };

  db:  HostServices['db'];
  net: HostServices['net'];
}

export function createMongolens(params: {
  pluginId: string;
  registries: RegistrySet;
  services: HostServices;
}): MongolensAPI {
  const { pluginId, registries: r, services } = params;
  return {
    commands: {
      register(id, handler) { return r.commands.register({ id, handler }, pluginId); },
      async execute(id, ...args) {
        const cmd = r.commands.get(id);
        if (!cmd) throw new Error(`Unknown command "${id}"`);
        return cmd.handler(...args);
      },
    },
    views:               { register: v => r.views.register(v, pluginId) },
    resultViewers:       { register: v => r.resultViewers.register(v, pluginId) },
    executionModes:      { register: v => r.executionModes.register(v, pluginId) },
    aiTools:             { register: v => r.aiTools.register(v, pluginId) },
    connectionProviders: { register: v => r.connectionProviders.register(v, pluginId) },
    themes:              { register: v => r.themes.register(v, pluginId) },
    exportTargets:       { register: v => r.exportTargets.register(v, pluginId) },

    db:  services.db,
    net: services.net,
  };
}
