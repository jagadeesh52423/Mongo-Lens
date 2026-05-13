import { Disposable } from './disposable';
import { RegistrySet } from '../registries';
import { HostServices } from '../hostServices';
import { Logger } from './logger';
import { runInPluginSandbox } from '../sandbox/runInPluginSandbox';
import {
  Command, ResultViewer, ViewProvider, ExecutionModeContract,
  AITool, ConnectionProvider, ThemeContract, ExportTargetContract,
} from './contracts';
import type { ConfigChangeEvent } from '../config';

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

  db:          HostServices['db'];
  net:         HostServices['net'];
  connections: HostServices['connections'];
  secrets:     HostServices['secrets'];
  workspace:   HostServices['workspace'];
  config: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    getAll(): Promise<Record<string, unknown>>;
    set(key: string, value: unknown): Promise<void>;
    onDidChange(listener: (e: ConfigChangeEvent) => void): { dispose(): void };
  };
}

export function createMongolens(params: {
  pluginId: string;
  registries: RegistrySet;
  services: HostServices;
  logger?: Logger;
  manifest?: { contributes?: { views?: { id: string; icon?: string }[] } };
}): MongolensAPI {
  const { pluginId, registries: r, services, manifest } = params;

  function manifestIconFor(viewId: string): string | undefined {
    return manifest?.contributes?.views?.find(v => v.id === viewId)?.icon;
  }

  return {
    commands: {
      register(id, handler) { return r.commands.register({ id, handler }, pluginId); },
      async execute(id, ...args) {
        const cmd = r.commands.get(id);
        if (!cmd) throw new Error(`Unknown command "${id}"`);
        // Spec §7: every host→plugin call must be wrapped in runInPluginSandbox.
        // Use the command owner's pluginId so isolation and timeouts are attributed
        // to the plugin that registered the handler, not the caller.
        const ownerId = r.commands.getOwner(id) ?? pluginId;
        const result = await runInPluginSandbox(ownerId, () => cmd.handler(...args), {
          onError: (pid, err) => params.logger?.error('command handler threw', { commandId: id, pluginId: pid, message: err.message }),
          timeoutMs: 5_000,
        });
        if (!result.ok) throw result.error;
        return result.value;
      },
    },
    views: {
      register: v => r.views.register(
        v.icon ? v : { ...v, icon: manifestIconFor(v.id) },
        pluginId,
      ),
    },
    resultViewers:       { register: v => r.resultViewers.register(v, pluginId) },
    executionModes:      { register: v => r.executionModes.register(v, pluginId) },
    aiTools:             { register: v => r.aiTools.register(v, pluginId) },
    connectionProviders: { register: v => r.connectionProviders.register(v, pluginId) },
    themes:              { register: v => r.themes.register(v, pluginId) },
    exportTargets:       { register: v => r.exportTargets.register(v, pluginId) },

    db:          services.db,
    net:         services.net,
    connections: services.connections,
    secrets:     services.secrets,
    workspace:   services.workspace,
    config: services.config ?? {
      get:         async () => undefined,
      getAll:      async () => ({}),
      set:         async () => { throw new Error('Plugin has no contributes.configuration'); },
      onDidChange: () => ({ dispose() {} }),
    },
  };
}
