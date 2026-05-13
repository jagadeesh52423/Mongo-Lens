import { PluginManager } from './PluginManager';
import { createRegistrySet, RegistrySet } from './registries';
import { PermissionBroker } from './PermissionBroker';
import { Logger } from './api/logger';
import { PluginFs } from './io';
import { HostBackend } from './hostServices';
import { defaultEnforcementRegistry } from './enforcement';
import {
  TauriKeychainBackend,
  InMemoryKeychainBackend,
} from './config';
import type { KeychainBackend, WorkspaceLike } from './config';

/** Simple in-memory WorkspaceLike — replaced by a persistent store in the real app. */
class InMemoryWorkspaceLike implements WorkspaceLike {
  private map = new Map<string, unknown>();
  async get(k: string) { return this.map.get(k); }
  async update(k: string, v: unknown) { this.map.set(k, v); }
}

function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface PluginHost {
  manager: PluginManager;
  registries: RegistrySet;
  broker: PermissionBroker;
  fs: PluginFs;
  workspace: WorkspaceLike;
  keychain: KeychainBackend;
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
  const keychain: KeychainBackend = isTauriEnv()
    ? new TauriKeychainBackend()
    : new InMemoryKeychainBackend();
  const workspace: WorkspaceLike = new InMemoryWorkspaceLike();
  const manager = new PluginManager({
    registries, broker,
    hostApiVersion: opts.hostApiVersion,
    logger: opts.logger,
    fs,
    pluginsRoot: opts.pluginsRoot,
    hostBackend: opts.hostBackend,
    enforcement: defaultEnforcementRegistry,
    workspace,
    keychain,
  });
  return { manager, registries, broker, fs, workspace, keychain };
}

function memFs(): PluginFs {
  return {
    async listPluginDirs() { return []; },
    async readManifest() { throw new Error('no fs'); },
    async readEntry() { throw new Error('no fs'); },
    pluginEntryPath: (d, m) => `${d}/${m}`,
  };
}
