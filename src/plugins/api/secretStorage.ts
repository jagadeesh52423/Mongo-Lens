import { KeychainBackend, InMemoryKeychainBackend } from '../config/keychainBackend';

export interface SecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemorySecretStorage implements SecretStorage {
  constructor(private readonly backend: KeychainBackend = new InMemoryKeychainBackend()) {}
  async get(key: string)              { return this.backend.get(key); }
  async store(key: string, v: string) { return this.backend.set(key, v); }
  async delete(key: string)           { return this.backend.delete(key); }
}

export function namespaceFor(pluginId: string, key: string): string {
  return `plugin:${pluginId}:secret:${key}`;
}
