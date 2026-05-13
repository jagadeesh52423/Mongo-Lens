import type { ConfigurationContribution, JSONSchemaProperty } from '../manifest';
import { validateConfig } from './schemaValidator';
import { ConfigStore } from './ConfigStore';
import type { PermissionBroker } from '../PermissionBroker';
import type { ConfigChangeEvent, Disposable } from './types';

interface ManagerLike {
  recheckEnforcement(pluginId: string): Promise<void> | void;
}

export class ConfigService {
  private listeners = new Set<(e: ConfigChangeEvent) => void>();
  private saveQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pluginId: string,
    private readonly schema: ConfigurationContribution,
    private readonly store: ConfigStore,
    private readonly broker: PermissionBroker,
    private readonly manager: ManagerLike,
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const prop = this.schema.properties[key];
    if (!prop) return undefined;
    if (this.isSecret(prop) && !this.hasSecretsRead()) return undefined;
    return (await this.store.getOne(key)) as T | undefined;
  }

  async getAll(): Promise<Record<string, unknown>> {
    const all = await this.store.getAll();
    if (this.hasSecretsRead()) return all;
    return this.stripSecrets(all);
  }

  async set(key: string, value: unknown): Promise<void> {
    const next = { ...(await this.store.getAll()), [key]: value };
    const errs = validateConfig(this.schema, next);
    if (errs.length) {
      throw new Error(`Config validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`);
    }
    await this.store.setMany({ [key]: value });
    this.fire([key], { [key]: value });
  }

  save(values: Record<string, unknown>): Promise<void> {
    const job = this.saveQueue.then(async () => {
      const errs = validateConfig(this.schema, values);
      if (errs.length) {
        throw new Error(`Config validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`);
      }
      const changedKeys = await this.store.setMany(values);
      if (changedKeys.length > 0) {
        const payload: Record<string, unknown> = {};
        for (const k of changedKeys) payload[k] = values[k];
        this.fire(changedKeys, payload);
      }
      await this.manager.recheckEnforcement(this.pluginId);
    });
    this.saveQueue = job.catch(() => undefined);
    return job;
  }

  onDidChange(listener: (e: ConfigChangeEvent) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private isSecret(p: JSONSchemaProperty): boolean {
    return p.type === 'string' && p['x-secret'] === true;
  }

  private hasSecretsRead(): boolean {
    try {
      this.broker.check(this.pluginId, { kind: 'secrets:read' });
      return true;
    } catch { return false; }
  }

  private stripSecrets(values: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      const p = this.schema.properties[k];
      if (p && this.isSecret(p)) continue;
      out[k] = v;
    }
    return out;
  }

  private fire(keys: string[], values: Record<string, unknown>) {
    const filtered = this.hasSecretsRead() ? values : this.stripSecrets(values);
    const event: ConfigChangeEvent = { keys, values: filtered };
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore listener errors */ }
    }
  }
}
