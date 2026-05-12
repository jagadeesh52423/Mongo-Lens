export interface SecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemorySecretStorage implements SecretStorage {
  private map = new Map<string, string>();
  async get(k: string)    { return this.map.get(k); }
  async store(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
}

export function namespaceFor(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}
