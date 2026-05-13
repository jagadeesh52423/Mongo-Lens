// implement this interface to add a new keychain storage backend
export interface KeychainBackend {
  get(namespace: string): Promise<string | undefined>;
  set(namespace: string, value: string): Promise<void>;
  delete(namespace: string): Promise<void>;
}

export class KeychainLockedError extends Error {
  constructor(message = 'Keychain is locked') {
    super(message);
    this.name = 'KeychainLockedError';
  }
}

export class InMemoryKeychainBackend implements KeychainBackend {
  private store = new Map<string, string>();
  async get(ns: string)            { return this.store.get(ns); }
  async set(ns: string, v: string) { this.store.set(ns, v); }
  async delete(ns: string)         { this.store.delete(ns); }
}
