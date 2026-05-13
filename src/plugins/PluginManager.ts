import { RegistrySet, disposeAllForPlugin } from './registries';
import { PermissionBroker } from './PermissionBroker';
import { validateManifest, PluginManifest } from './manifest';
import { Logger } from './api/logger';
import { PluginFs } from './io';
import { createExtensionContext, ExtensionContext } from './ExtensionContext';
import { InMemorySecretStorage } from './api/secretStorage';
import { InMemoryWorkspaceStore } from './api/workspaceStore';
import { createPluginLogger } from './api/logger';
import { createMongolens, MongolensAPI } from './api/createMongolens';
import { createHostServices, HostBackend } from './hostServices';
import { runInPluginSandbox } from './sandbox/runInPluginSandbox';
import { wrapPluginSource, LoadedModule } from './sandbox/moduleLoader';
import { parseScope } from './permissions';
import { Registry } from './Registry';
import { EnforcementRegistry } from './enforcement';
import type { Finding } from './enforcement';
import type { KeychainBackend, WorkspaceLike } from './config';

export type PluginState =
  | 'discovered'      // manifest valid, contributions registered, not activated
  | 'incompatible'    // engines.mongolens does not satisfy hostApiVersion
  | 'broken'          // manifest invalid or file IO failed
  | 'activating'
  | 'active'
  | 'failed'          // activation errored
  | 'disabled';

export interface PluginRecord {
  id: string;
  manifest?: PluginManifest;
  dir: string;
  /** Webview-loadable URL for the plugin's icon file when one is present at its root. */
  iconUrl?: string;
  state: PluginState;
  errors?: string[];
  /** Findings emitted by enforcement rules at discovery; empty when clean. */
  findings: Finding[];
}

interface ManagerOptions {
  registries: RegistrySet;
  broker: PermissionBroker;
  hostApiVersion: string;
  logger: Logger;
  fs: PluginFs;
  pluginsRoot?: string;
  hostBackend?: HostBackend;
  entryLoader?: (record: PluginRecord) => Promise<LoadedModule>;
  enforcement?: EnforcementRegistry;
  workspace?: WorkspaceLike;
  keychain?: KeychainBackend;
}

export class PluginManager {
  private records = new Map<string, PluginRecord>();
  private contexts = new Map<string, ExtensionContext>();
  private loadedModules = new Map<string, LoadedModule>();
  private readonly enforcement: EnforcementRegistry;
  // implement this interface to add a new change listener variant
  private changeListeners = new Set<() => void>();

  constructor(private readonly opts: ManagerOptions) {
    this.enforcement = opts.enforcement ?? new EnforcementRegistry();
  }

  /** Subscribe to any record state change. Returns a disposable. */
  onDidChange(listener: () => void): { dispose(): void } {
    this.changeListeners.add(listener);
    return { dispose: () => { this.changeListeners.delete(listener); } };
  }

  private fireChange(): void {
    for (const l of this.changeListeners) {
      try { l(); } catch { /* ignore listener errors */ }
    }
  }

  list(): PluginRecord[] {
    return Array.from(this.records.values());
  }

  get(id: string): PluginRecord | undefined {
    return this.records.get(id);
  }

  async discover(): Promise<void> {
    const dirs = await this.opts.fs.listPluginDirs();
    for (const dir of dirs) {
      await this.loadOne(dir);
    }
  }

  private async loadOne(dir: string): Promise<void> {
    const id = dir.split('/').pop() ?? dir;
    try {
      const raw = await this.opts.fs.readManifest(dir);
      const parsed = JSON.parse(raw) as unknown;
      const v = validateManifest(parsed);
      if (!v.ok || !v.manifest) {
        this.records.set(id, { id, dir, state: 'broken', errors: v.errors, findings: [] });
        this.opts.logger.warn('Plugin manifest invalid', { dir, errors: v.errors });
        this.fireChange();
        return;
      }
      if (!satisfies(this.opts.hostApiVersion, v.manifest.engines.mongolens)) {
        this.records.set(v.manifest.id, { id: v.manifest.id, dir, manifest: v.manifest, state: 'incompatible', findings: [] });
        this.opts.logger.warn('Plugin incompatible with host', { id: v.manifest.id });
        this.fireChange();
        return;
      }
      const findings = await this.enforcement.runAll({
        pluginDir: dir,
        manifest: v.manifest,
        fs: this.opts.fs,
        workspace: this.opts.workspace,
        keychain: this.opts.keychain,
      });
      const iconUrl = await resolvePluginIconUrl(this.opts.fs, dir);
      this.records.set(v.manifest.id, {
        id: v.manifest.id,
        dir,
        iconUrl,
        manifest: v.manifest,
        state: 'discovered',
        findings,
      });
      this.fireChange();
      // Note: command/view/etc. *contributions* are pure metadata; runtime handlers
      // are registered only at activate(). So we don't push into Registry<T> here.
    } catch (e) {
      this.records.set(id, { id, dir, state: 'broken', errors: [String(e)], findings: [] });
      this.fireChange();
    }
  }

  async activate(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec || !rec.manifest) {
      this.opts.logger.warn('activate: unknown plugin', { id });
      return;
    }
    if (rec.state === 'active' || rec.state === 'activating') return;
    if (hasBlockingFindings(rec)) {
      rec.state = 'failed';
      rec.errors = rec.findings.filter(f => f.severity === 'error').map(f => f.message);
      this.opts.logger.warn('activate: blocking findings prevent activation', { id, findings: rec.errors });
      this.fireChange();
      return;
    }
    rec.state = 'activating';

    // Apply granted scopes (parsed from manifest.permissions for v1 — consent dialog
    // wires in real grants in Task 21).
    const scopes = (rec.manifest.permissions ?? []).map(parseScope);
    this.opts.broker.setGrants(id, scopes);

    const logger    = createPluginLogger(id, this.opts.logger);
    const secrets   = new InMemorySecretStorage();
    const workspace = new InMemoryWorkspaceStore();
    const ctx       = createExtensionContext({ pluginId: id, storagePath: `${rec.dir}/.data`, secrets, logger });
    const backend: HostBackend = this.opts.hostBackend ?? defaultBackend();
    const services  = createHostServices({ broker: this.opts.broker, pluginId: id, backend, secrets, workspace });
    const api: MongolensAPI = createMongolens({ pluginId: id, registries: this.opts.registries, services, logger: this.opts.logger, manifest: rec.manifest });
    this.contexts.set(id, ctx);

    const result = await runInPluginSandbox(id, async () => {
      // Guard against concurrent activate() calls racing on the shared global.
      // Sequential today (activateForEvent awaits each call), but public API
      // allows parallel callers. Fail fast rather than silently mixing bindings.
      if ('mongolens' in globalThis) {
        throw new Error('Concurrent plugin activation is not supported — activate() must be called sequentially');
      }
      // Inject `mongolens` BEFORE loading so the CJS test-path fallback in
      // defaultLoader can capture it when building the module via new Function().
      // The production blob-URL path reads it via closure at activate() call-time,
      // but the CJS path captures it at load-time — so the order matters.
      (globalThis as Record<string, unknown>).mongolens = api;
      try {
        const mod = this.opts.entryLoader
          ? await this.opts.entryLoader(rec)
          : await defaultLoader(this.opts.fs, rec);
        this.loadedModules.set(id, mod);
        if (typeof mod.activate === 'function') await mod.activate(ctx);
      } finally {
        delete (globalThis as Record<string, unknown>).mongolens;
      }
    }, {
      onError: (pid, err) => this.opts.logger.error('Plugin activation failed', { pluginId: pid, message: err.message }),
      timeoutMs: 10_000,
    });

    if (!result.ok) {
      rec.state = 'failed';
      rec.errors = [result.error.message];
      this.opts.broker.clearGrants(id);
      disposeAllForPlugin(this.opts.registries, id);
      this.contexts.delete(id);
      this.fireChange();
      return;
    }
    rec.state = 'active';
    this.fireChange();
  }

  async deactivate(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    const mod = this.loadedModules.get(id);
    const ctx = this.contexts.get(id);

    if (mod?.deactivate) {
      await runInPluginSandbox(id, () => mod.deactivate!(), {
        onError: (pid, err) => this.opts.logger.warn('Plugin deactivate threw', { pluginId: pid, message: err.message }),
        timeoutMs: 2000,
      });
    }
    if (ctx) {
      for (let i = ctx.subscriptions.length - 1; i >= 0; i--) {
        try { await ctx.subscriptions[i].dispose(); } catch (e) {
          this.opts.logger.warn('Subscription dispose threw', { pluginId: id, message: String(e) });
        }
      }
    }
    disposeAllForPlugin(this.opts.registries, id);
    this.opts.broker.clearGrants(id);
    this.loadedModules.delete(id);
    this.contexts.delete(id);
    rec.state = 'disabled';
    this.fireChange();
  }

  async activateForEvent(event: string): Promise<void> {
    for (const rec of this.records.values()) {
      if (rec.state !== 'discovered') continue;
      if ((rec.manifest?.activationEvents ?? []).includes(event)) {
        await this.activate(rec.id);
      }
    }
  }

  async activateStartup(): Promise<void> {
    await this.activateForEvent('onStartup');
  }

  async recheckEnforcement(pluginId: string): Promise<void> {
    const rec = this.records.get(pluginId);
    if (!rec || !rec.manifest) return;
    rec.findings = await this.enforcement.runAll({
      pluginDir: rec.dir,
      manifest: rec.manifest,
      fs: this.opts.fs,
      workspace: this.opts.workspace,
      keychain: this.opts.keychain,
    });
    this.fireChange();
  }

  async install(srcDir: string): Promise<string> {
    if (!this.opts.fs.copyDir || !this.opts.pluginsRoot) {
      throw new Error('install requires fs.copyDir and pluginsRoot');
    }
    const raw = await this.opts.fs.readManifest(srcDir);
    const v = validateManifest(JSON.parse(raw) as unknown);
    if (!v.ok || !v.manifest) throw new Error(`Invalid manifest: ${v.errors?.join('; ')}`);
    const dest = `${this.opts.pluginsRoot}/${v.manifest.id}`;
    await this.opts.fs.copyDir(srcDir, dest);
    await this.loadOne(dest);
    return v.manifest.id;
  }

  async uninstall(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    if (rec.state === 'active') await this.deactivate(id);
    if (this.opts.fs.removeDir) await this.opts.fs.removeDir(rec.dir);
    this.records.delete(id);
  }
}

// Minimal semver range check sufficient for v1: supports "^X.Y.Z" only.
// Major must match; minor/patch of host must be >= manifest's.
export function satisfies(hostVersion: string, range: string): boolean {
  const m = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [maj, min, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = hostVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!h) return false;
  const [hMaj, hMin, hPatch] = [Number(h[1]), Number(h[2]), Number(h[3])];
  if (hMaj !== maj) return false;
  if (hMin > min) return true;
  if (hMin < min) return false;
  return hPatch >= patch;
}

function defaultBackend(): HostBackend {
  return {
    async dbFind() { throw new Error('Host backend not wired (test stub)'); },
    async netFetch() { throw new Error('Host backend not wired (test stub)'); },
    async connectionsList() { return []; },
    async connectionsUpdateCredentials() { throw new Error('Host backend not wired (test stub)'); },
  };
}

async function defaultLoader(fs: PluginFs, rec: PluginRecord): Promise<LoadedModule> {
  if (!rec.manifest) throw new Error('No manifest');
  const source = await fs.readEntry(fs.pluginEntryPath(rec.dir, rec.manifest.main));
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
    // Production path — renderer
    const { loadPluginModule } = await import('./sandbox/moduleLoader');
    return loadPluginModule(source);
  }
  // Test path — jsdom without ESM blob support
  const cjsSource = wrapPluginSource(source)
    .replace(/export\s+function\s+(\w+)/g, 'exports.$1 = function')
    .replace(/export\s+const\s+(\w+)\s*=/g, 'exports.$1 =');
  const fn = new Function('exports', 'mongolens', `${cjsSource}\nreturn exports;`);
  const exports: Record<string, unknown> = {};
  return fn(exports, (globalThis as Record<string, unknown>).mongolens) as LoadedModule;
}

export function hasBlockingFindings(rec: PluginRecord): boolean {
  return rec.findings.some((f) => f.severity === 'error');
}

const ICON_CANDIDATES = ['icon.svg', 'icon.png', 'logo.svg', 'logo.png'];

async function resolvePluginIconUrl(fs: PluginFs, dir: string): Promise<string | undefined> {
  if (!fs.pluginFileUrl) return undefined;
  for (const candidate of ICON_CANDIDATES) {
    try {
      const url = await fs.pluginFileUrl(dir, candidate);
      if (url) return url;
    } catch { /* try next candidate */ }
  }
  return undefined;
}

// Re-export so consumers don't need to know the Registry generic.
export { Registry };
