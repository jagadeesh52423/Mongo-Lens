import type { ConfigurationContribution, JSONSchemaProperty } from '../manifest';
import type { KeychainBackend } from './keychainBackend';

export interface WorkspaceLike {
  get(key: string): Promise<unknown>;
  update(key: string, value: unknown): Promise<void>;
}

export class ConfigStore {
  constructor(
    private readonly pluginId: string,
    private readonly schema: ConfigurationContribution,
    private readonly workspace: WorkspaceLike,
    private readonly keychain: KeychainBackend,
  ) {}

  async getAll(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(this.schema.properties)) {
      out[key] = await this.getOne(key, prop);
    }
    return out;
  }

  async getOne(key: string, prop?: JSONSchemaProperty): Promise<unknown> {
    const p = prop ?? this.schema.properties[key];
    if (!p) return undefined;
    if (this.isSecret(p)) {
      const v = await this.keychain.get(this.secretNs(key));
      return v ?? p.default;
    }
    const v = await this.workspace.get(this.plainNs(key));
    return v === undefined ? p.default : v;
  }

  /** Writes all values atomically; returns keys whose stored value differs from before. */
  async setMany(values: Record<string, unknown>): Promise<string[]> {
    const before: Record<string, unknown> = {};
    const secretWrites: Array<[string, string]> = [];
    const plainWrites:  Array<[string, unknown]> = [];

    for (const [key, value] of Object.entries(values)) {
      const prop = this.schema.properties[key];
      if (!prop) continue;
      before[key] = await this.getOne(key, prop);
      if (this.isSecret(prop)) {
        secretWrites.push([this.secretNs(key), String(value ?? '')]);
      } else {
        plainWrites.push([this.plainNs(key), value]);
      }
    }

    // Secrets first — if keychain throws, no plain writes happen.
    for (const [ns, v] of secretWrites) await this.keychain.set(ns, v);
    for (const [ns, v] of plainWrites)  await this.workspace.update(ns, v);

    const changed: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (this.schema.properties[key] && before[key] !== value) changed.push(key);
    }
    return changed;
  }

  private isSecret(p: JSONSchemaProperty): boolean {
    return p.type === 'string' && p['x-secret'] === true;
  }
  private secretNs(key: string): string { return `plugin:${this.pluginId}:config:${key}`; }
  private plainNs(key: string):  string { return `plugin.${this.pluginId}.config.${key}`; }
}
