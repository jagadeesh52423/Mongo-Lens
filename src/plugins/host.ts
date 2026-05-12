import { PluginManager } from './PluginManager';
import { createRegistrySet, RegistrySet } from './registries';
import { PermissionBroker } from './PermissionBroker';
import { Logger } from './api/logger';
import { PluginFs } from './io';
import { HostBackend } from './hostServices';

export interface PluginHost {
  manager: PluginManager;
  registries: RegistrySet;
  broker: PermissionBroker;
}

export function createPluginHost(opts: {
  hostApiVersion: string;
  logger: Logger;
  fs?: PluginFs;
  pluginsRoot?: string;
  hostBackend?: HostBackend;
}): PluginHost {
  const registries = createRegistrySet();
  const broker = new PermissionBroker();
  const fs = opts.fs ?? memFs();
  const manager = new PluginManager({
    registries, broker,
    hostApiVersion: opts.hostApiVersion,
    logger: opts.logger,
    fs,
    pluginsRoot: opts.pluginsRoot,
    hostBackend: opts.hostBackend,
  });
  return { manager, registries, broker };
}

function memFs(): PluginFs {
  return {
    async listPluginDirs() { return []; },
    async readManifest() { throw new Error('no fs'); },
    async readEntry() { throw new Error('no fs'); },
    pluginEntryPath: (d, m) => `${d}/${m}`,
  };
}
